"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getClientSession } from "@/lib/client-auth";
import { createAuthClient } from "@/lib/supabase/server";

export type ClientPasswordState = {
  error: string;
};

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1).max(200),
    newPassword: z
      .string()
      .min(12, "Use at least 12 characters for your new password.")
      .max(200)
      .regex(/[a-z]/, "Add at least one lowercase letter.")
      .regex(/[A-Z]/, "Add at least one uppercase letter.")
      .regex(/[0-9]/, "Add at least one number."),
    confirmation: z.string().min(1).max(200),
  })
  .refine((value) => value.newPassword === value.confirmation, {
    message: "The new passwords do not match.",
    path: ["confirmation"],
  })
  .refine((value) => value.currentPassword !== value.newPassword, {
    message: "Choose a new password that is different from your current password.",
    path: ["newPassword"],
  });

function connectionFailure(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { message?: string; status?: number };
  const message = candidate.message?.toLowerCase() || "";
  return candidate.status === 0 || message.includes("fetch failed") || message.includes("network");
}

export async function changeClientPasswordAction(
  _previousState: ClientPasswordState,
  formData: FormData,
): Promise<ClientPasswordState> {
  const client = await getClientSession();
  if (!client || client.status !== "approved" || !client.email) {
    return { error: "Your session expired. Sign in again before changing your password." };
  }

  const parsed = passwordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    confirmation: formData.get("confirmation"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message || "Check the password fields and try again." };
  }

  const authClient = await createAuthClient();
  let signInResult;
  try {
    signInResult = await authClient.auth.signInWithPassword({
      email: client.email,
      password: parsed.data.currentPassword,
    });
  } catch (error) {
    return {
      error: connectionFailure(error)
        ? "Authentication is temporarily unavailable. Check your connection and try again."
        : "Your current password could not be verified.",
    };
  }

  if (
    signInResult.error ||
    !signInResult.data.user ||
    signInResult.data.user.id !== client.userId
  ) {
    return {
      error: connectionFailure(signInResult.error)
        ? "Authentication is temporarily unavailable. Check your connection and try again."
        : "The current password is incorrect.",
    };
  }

  let updateError;
  try {
    ({ error: updateError } = await authClient.auth.updateUser({
      password: parsed.data.newPassword,
    }));
  } catch (error) {
    return {
      error: connectionFailure(error)
        ? "Authentication is temporarily unavailable. Check your connection and try again."
        : "The password could not be updated. Please try again.",
    };
  }

  if (updateError) {
    return {
      error: updateError.message.toLowerCase().includes("same")
        ? "Choose a password you have not used for this account."
        : "The password could not be updated. Please try again.",
    };
  }

  await authClient.auth.signOut({ scope: "global" });
  redirect("/login?password=changed");
}
