"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getAdminSession } from "@/lib/admin-auth";
import { createAuthClient } from "@/lib/supabase/server";

export type UpdatePasswordState = {
  error: string;
};

const passwordSchema = z
  .object({
    password: z.string().min(12).max(200),
    confirmation: z.string().min(12).max(200),
  })
  .refine((value) => value.password === value.confirmation, {
    message: "Passwords do not match.",
  });

export async function updatePasswordAction(
  _previousState: UpdatePasswordState,
  formData: FormData,
): Promise<UpdatePasswordState> {
  const admin = await getAdminSession();
  if (!admin) return { error: "Your recovery session expired. Request a new reset link." };

  const parsed = passwordSchema.safeParse({
    password: formData.get("password"),
    confirmation: formData.get("confirmation"),
  });

  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message === "Passwords do not match."
        ? "Passwords do not match."
        : "Use at least 12 characters for your new password.",
    };
  }

  const authClient = await createAuthClient();
  const { error } = await authClient.auth.updateUser({
    password: parsed.data.password,
  });

  if (error) {
    return { error: error.message || "The password could not be updated." };
  }

  await authClient.auth.signOut();
  redirect("/admin/login?reset=success");
}

