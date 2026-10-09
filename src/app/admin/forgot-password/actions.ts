"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { createAuthClient } from "@/lib/supabase/server";
import { hasAdminConfiguration } from "@/lib/supabase/config";

export type ForgotPasswordState = {
  status: "idle" | "success" | "error";
  message: string;
};

const emailSchema = z.string().trim().email().max(254);

function getBaseUrl(headerStore: Awaited<ReturnType<typeof headers>>) {
  if (process.env.SITE_URL) return new URL(process.env.SITE_URL).origin;

  if (process.env.NODE_ENV === "development") return "http://localhost:3000";

  const host = headerStore.get("x-forwarded-host") || headerStore.get("host");
  const protocol = headerStore.get("x-forwarded-proto") || "https";
  return host ? `${protocol}://${host}` : "";
}

export async function requestPasswordResetAction(
  _previousState: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  if (!hasAdminConfiguration()) {
    return { status: "error", message: "Admin authentication is not configured yet." };
  }

  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) {
    return { status: "error", message: "Enter a valid administrator email address." };
  }

  const headerStore = await headers();
  const baseUrl = getBaseUrl(headerStore);
  if (!baseUrl) {
    return { status: "error", message: "The website URL could not be determined." };
  }

  const authClient = await createAuthClient();
  const { error } = await authClient.auth.resetPasswordForEmail(parsed.data, {
    redirectTo: `${baseUrl}/admin/auth/callback?next=/admin/reset-password`,
  });

  if (error) {
    console.error("Admin password reset request failed", error.code);

    const isEmailRateLimit =
      error.status === 429 ||
      error.code === "over_email_send_rate_limit" ||
      error.message.toLowerCase().includes("email rate limit exceeded");

    if (isEmailRateLimit) {
      return {
        status: "error",
        message:
          "The Supabase recovery-email limit has been reached. Please wait about one hour before requesting another link.",
      };
    }

    return {
      status: "error",
      message: "We could not send the reset email. Please try again later.",
    };
  }

  return {
    status: "success",
    message: "If that administrator account exists, a fresh password-reset link has been sent.",
  };
}
