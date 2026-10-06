import "server-only";

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createAuthClient } from "@/lib/supabase/server";
import { hasAdminConfiguration } from "@/lib/supabase/config";

export type AdminSession = {
  userId: string;
  email: string;
  displayName: string;
  role: "owner" | "admin" | "support";
};

export async function getAdminSession(): Promise<AdminSession | null> {
  if (!hasAdminConfiguration()) return null;

  const authClient = await createAuthClient();
  const { data, error } = await authClient.auth.getClaims();
  const userId = data?.claims?.sub;

  if (error || !userId) return null;

  const adminClient = createAdminClient();
  const { data: admin, error: adminError } = await adminClient
    .from("admin_users")
    .select("display_name, role, is_active")
    .eq("user_id", userId)
    .maybeSingle();

  if (adminError || !admin?.is_active) return null;

  if (!["owner", "admin", "support"].includes(admin.role)) return null;

  return {
    userId,
    email: typeof data.claims.email === "string" ? data.claims.email : "",
    displayName: admin.display_name,
    role: admin.role as AdminSession["role"],
  };
}

export async function requireAdmin({ touch = true }: { touch?: boolean } = {}) {
  if (!hasAdminConfiguration()) {
    redirect("/admin/login?setup=configuration");
  }

  const admin = await getAdminSession();

  if (!admin) redirect("/admin/login");

  if (touch) {
    const adminClient = createAdminClient();
    await adminClient
      .from("admin_users")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("user_id", admin.userId);
  }

  return admin;
}
