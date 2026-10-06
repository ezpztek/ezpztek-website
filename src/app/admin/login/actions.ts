"use server";

import { createHmac } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { verifyEmergencyPin } from "@/lib/emergency-pin";
import { createAdminClient } from "@/lib/supabase/admin";
import { createAuthClient } from "@/lib/supabase/server";
import {
  hasAdminConfiguration,
  hasEmergencyPinConfiguration,
} from "@/lib/supabase/config";

export type LoginState = {
  error: string;
};

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(200),
});

const emergencyPinSchema = z.string().regex(/^\d{6,12}$/);

function isConnectionError(error: { message?: string; status?: number } | null) {
  if (!error) return false;
  const message = error.message?.toLowerCase() || "";
  return (
    error.status === 0 ||
    message.includes("fetch failed") ||
    message.includes("network")
  );
}

type EmergencyAttemptResult = {
  allowed: boolean;
  retry_after_seconds: number;
};

function createRequestFingerprint(
  headerStore: Awaited<ReturnType<typeof headers>>,
  secret: string,
) {
  const forwardedIp = headerStore.get("x-forwarded-for")?.split(",")[0];
  const clientIp = forwardedIp?.trim() || headerStore.get("x-real-ip") || "unknown";
  return createHmac("sha256", secret).update(clientIp).digest("hex");
}

export async function loginAction(
  _previousState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  if (!hasAdminConfiguration()) {
    return {
      error:
        "Admin authentication is not configured yet. Add the Supabase publishable key to your environment.",
    };
  }

  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: "Enter a valid email address and password." };
  }

  const authClient = await createAuthClient();
  const { data, error } = await authClient.auth.signInWithPassword(parsed.data);

  if (error || !data.user) {
    if (isConnectionError(error)) {
      return {
        error: "The local server cannot connect to Supabase. Restart localhost and try again.",
      };
    }
    return { error: "The email or password is incorrect." };
  }

  const adminClient = createAdminClient();
  const { data: admin, error: adminError } = await adminClient
    .from("admin_users")
    .select("is_active")
    .eq("user_id", data.user.id)
    .maybeSingle();

  if (adminError || !admin?.is_active) {
    await authClient.auth.signOut();
    return {
      error: adminError
        ? "Run the admin database migration before signing in."
        : "This account is not authorized for the EZPZTEK admin workspace.",
    };
  }

  redirect("/admin");
}

export async function emergencyPinLoginAction(
  _previousState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  if (!hasEmergencyPinConfiguration()) {
    return { error: "Emergency access has not been configured." };
  }

  const parsed = emergencyPinSchema.safeParse(formData.get("pin"));
  if (!parsed.success) {
    return { error: "Enter your 6–12 digit emergency PIN." };
  }

  const rateLimitSecret = process.env.RATE_LIMIT_SECRET!;
  const expectedPinHash = process.env.ADMIN_EMERGENCY_PIN_HASH!;
  const headerStore = await headers();
  const fingerprint = createRequestFingerprint(headerStore, rateLimitSecret);
  const adminClient = createAdminClient();

  const { data: attemptRows, error: attemptError } = await adminClient.rpc(
    "consume_admin_emergency_attempt",
    { p_fingerprint: fingerprint },
  );
  const attempt = (attemptRows?.[0] || null) as EmergencyAttemptResult | null;

  if (attemptError || !attempt) {
    console.error(
      "Emergency access rate-limit check failed",
      attemptError?.code || attemptError?.message,
    );
    return {
      error: isConnectionError(attemptError)
        ? "The local server cannot connect to Supabase. Restart localhost and try again."
        : "Emergency access is unavailable until its database setup is completed.",
    };
  }

  if (!attempt.allowed) {
    const minutes = Math.max(1, Math.ceil(attempt.retry_after_seconds / 60));
    return { error: `Too many attempts. Try again in about ${minutes} minutes.` };
  }

  if (!(await verifyEmergencyPin(parsed.data, expectedPinHash))) {
    return { error: "The emergency PIN is incorrect." };
  }

  const { data: owners, error: ownerError } = await adminClient
    .from("admin_users")
    .select("user_id")
    .eq("role", "owner")
    .eq("is_active", true)
    .limit(2);

  if (ownerError || owners?.length !== 1) {
    return { error: "Emergency access requires exactly one active owner." };
  }

  const ownerId = owners[0].user_id;
  const { data: ownerData, error: authUserError } =
    await adminClient.auth.admin.getUserById(ownerId);
  const ownerEmail = ownerData.user?.email;

  if (authUserError || !ownerEmail) {
    return { error: "The owner authentication account could not be loaded." };
  }

  const { data: linkData, error: linkError } =
    await adminClient.auth.admin.generateLink({
      type: "magiclink",
      email: ownerEmail,
    });
  const tokenHash = linkData.properties?.hashed_token;

  if (linkError || !tokenHash) {
    console.error("Emergency owner link generation failed", linkError?.code);
    return { error: "Emergency access could not create a secure owner session." };
  }

  const authClient = await createAuthClient();
  const { data: verification, error: verificationError } =
    await authClient.auth.verifyOtp({
      token_hash: tokenHash,
      type: "magiclink",
    });

  if (
    verificationError ||
    !verification.user ||
    verification.user.id !== ownerId
  ) {
    await authClient.auth.signOut();
    return { error: "Emergency access could not verify the owner session." };
  }

  await Promise.all([
    adminClient
      .from("admin_emergency_login_attempts")
      .delete()
      .eq("request_fingerprint", fingerprint),
    adminClient.from("admin_activity_log").insert({
      admin_user_id: ownerId,
      action: "emergency_pin_login",
      entity_type: "admin_session",
      entity_id: ownerId,
      details: { method: "emergency_pin" },
    }),
  ]);

  redirect("/admin");
}
