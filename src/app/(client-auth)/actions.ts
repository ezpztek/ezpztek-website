"use server";

import { createHash } from "node:crypto";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createAuthClient } from "@/lib/supabase/server";

export type ClientAuthState = {
  error: string;
};

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(10).max(200),
});

const registrationSchema = z
  .object({
    token: z.string().min(20).max(200),
    displayName: z.string().trim().min(2).max(100),
    password: z
      .string()
      .min(10)
      .max(200)
      .regex(/[a-z]/, "Password needs a lowercase letter.")
      .regex(/[A-Z]/, "Password needs an uppercase letter.")
      .regex(/[0-9]/, "Password needs a number."),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

function isConnectionError(error: { message?: string; status?: number } | null) {
  if (!error) return false;
  const message = error.message?.toLowerCase() || "";
  return error.status === 0 || message.includes("fetch failed") || message.includes("network");
}

export async function clientLoginAction(
  _previousState: ClientAuthState,
  formData: FormData,
): Promise<ClientAuthState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: "Enter a valid email and password." };

  const authClient = await createAuthClient();
  const { data, error } = await authClient.auth.signInWithPassword(parsed.data);

  if (error || !data.user) {
    return {
      error: isConnectionError(error)
        ? "The server cannot connect to authentication right now. Please try again."
        : "The email or password is incorrect.",
    };
  }

  const supabase = createAdminClient();
  const { data: account, error: accountError } = await supabase
    .from("client_portal_accounts")
    .select("status")
    .eq("user_id", data.user.id)
    .maybeSingle();

  if (accountError || !account) {
    await authClient.auth.signOut();
    return { error: "This account does not have access to the EZPZTEK client portal." };
  }

  if (account.status === "pending") redirect("/portal/pending");
  if (account.status !== "approved") {
    await authClient.auth.signOut();
    return { error: "This client workspace is currently unavailable. Please contact EZPZTEK." };
  }

  redirect("/portal");
}

export async function registerClientAction(
  _previousState: ClientAuthState,
  formData: FormData,
): Promise<ClientAuthState> {
  const parsed = registrationSchema.safeParse({
    token: formData.get("token"),
    displayName: formData.get("displayName"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message || "Check your registration details." };
  }

  const tokenHash = createHash("sha256").update(parsed.data.token).digest("hex");
  const supabase = createAdminClient();
  const { data: invitation, error: invitationError } = await supabase
    .from("client_invitations")
    .select("id, client_id, email, status, expires_at, clients!inner(business_name)")
    .eq("token_hash", tokenHash)
    .eq("status", "pending")
    .maybeSingle();

  if (
    invitationError ||
    !invitation ||
    new Date(invitation.expires_at) <= new Date()
  ) {
    return { error: "This invitation is invalid, expired, or already used." };
  }

  const { data: createdUser, error: createUserError } =
    await supabase.auth.admin.createUser({
      email: invitation.email,
      password: parsed.data.password,
      email_confirm: true,
      user_metadata: {
        display_name: parsed.data.displayName,
        client_id: invitation.client_id,
      },
    });

  if (createUserError || !createdUser.user) {
    return {
      error: createUserError?.message.toLowerCase().includes("already")
        ? "An account already exists for this email. Use the login page or contact EZPZTEK."
        : "We could not create your credentials. Please contact EZPZTEK.",
    };
  }

  const { error: accountError } = await supabase
    .from("client_portal_accounts")
    .insert({
      user_id: createdUser.user.id,
      client_id: invitation.client_id,
      invitation_id: invitation.id,
      display_name: parsed.data.displayName,
      status: "pending",
    });

  if (accountError) {
    await supabase.auth.admin.deleteUser(createdUser.user.id);
    return { error: "We could not finish creating your workspace. Please contact EZPZTEK." };
  }

  await supabase
    .from("client_invitations")
    .update({ status: "accepted", accepted_at: new Date().toISOString() })
    .eq("id", invitation.id)
    .eq("status", "pending");

  const authClient = await createAuthClient();
  const { error: signInError } = await authClient.auth.signInWithPassword({
    email: invitation.email,
    password: parsed.data.password,
  });

  if (signInError) redirect("/login?registered=1");
  redirect("/portal/pending");
}

export async function clientLogoutAction() {
  const authClient = await createAuthClient();
  await authClient.auth.signOut();
  redirect("/login");
}

