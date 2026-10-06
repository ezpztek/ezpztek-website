import "server-only";

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createAuthClient } from "@/lib/supabase/server";
import { hasAdminConfiguration } from "@/lib/supabase/config";

export type ClientSession = {
  userId: string;
  email: string;
  displayName: string;
  clientId: string;
  businessName: string;
  status: "pending" | "approved" | "suspended" | "rejected";
};

export async function getClientSession(): Promise<ClientSession | null> {
  if (!hasAdminConfiguration()) return null;

  const authClient = await createAuthClient();
  const { data, error } = await authClient.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || !userId) return null;

  const adminClient = createAdminClient();
  const { data: account, error: accountError } = await adminClient
    .from("client_portal_accounts")
    .select("user_id, client_id, display_name, status, clients!inner(business_name)")
    .eq("user_id", userId)
    .maybeSingle();

  if (accountError || !account) return null;
  if (!["pending", "approved", "suspended", "rejected"].includes(account.status)) return null;

  const relatedClient = Array.isArray(account.clients)
    ? account.clients[0]
    : account.clients;

  return {
    userId,
    email: typeof data.claims.email === "string" ? data.claims.email : "",
    displayName: account.display_name,
    clientId: account.client_id,
    businessName: relatedClient?.business_name || "Your business",
    status: account.status as ClientSession["status"],
  };
}

export async function requireClient({
  allowPending = false,
}: {
  allowPending?: boolean;
} = {}) {
  const client = await getClientSession();
  if (!client) redirect("/login");

  if (!allowPending && client.status !== "approved") {
    if (client.status === "pending") redirect("/portal/pending");
    redirect("/login?access=unavailable");
  }

  const adminClient = createAdminClient();
  await adminClient
    .from("client_portal_accounts")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("user_id", client.userId);

  return client;
}

export async function requireClientModule(moduleCode: string) {
  const client = await requireClient();
  const adminClient = createAdminClient();
  const { data: moduleAccess, error } = await adminClient
    .from("client_module_access")
    .select("access_mode, solution_modules!inner(id, code, name)")
    .eq("account_user_id", client.userId)
    .eq("solution_modules.code", moduleCode)
    .maybeSingle();

  if (error || !moduleAccess) redirect("/portal");

  return { client, moduleAccess };
}
