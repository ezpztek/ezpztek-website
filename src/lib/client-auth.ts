import "server-only";

import { cache } from "react";
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
  hasLogo: boolean;
  logoUpdatedAt: string | null;
  status: "pending" | "approved" | "suspended" | "rejected";
};

export type ClientModule = {
  id: string;
  code: string;
  name: string;
  description: string;
  category: string;
  features: string[];
  sortOrder: number;
  accessMode: string;
};

type ClientAccountRow = {
  user_id: string;
  client_id: string;
  display_name: string;
  status: string;
  clients: {
    business_name: string;
    logo_object_key?: string | null;
    logo_updated_at?: string | null;
  } | Array<{
    business_name: string;
    logo_object_key?: string | null;
    logo_updated_at?: string | null;
  }>;
};

export const getClientSession = cache(async (): Promise<ClientSession | null> => {
  if (!hasAdminConfiguration()) return null;

  const authClient = await createAuthClient();
  const { data, error } = await authClient.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || !userId) return null;

  const adminClient = createAdminClient();
  const accountWithBranding = await adminClient
    .from("client_portal_accounts")
    .select("user_id, client_id, display_name, status, clients!inner(business_name, logo_object_key, logo_updated_at)")
    .eq("user_id", userId)
    .maybeSingle();

  let account = accountWithBranding.data as ClientAccountRow | null;
  let accountError = accountWithBranding.error;
  if (accountError) {
    // Keep authentication usable during the short rollout window before
    // migration 013 is applied. Normal deployments use the single query above.
    const fallback = await adminClient
      .from("client_portal_accounts")
      .select("user_id, client_id, display_name, status, clients!inner(business_name)")
      .eq("user_id", userId)
      .maybeSingle();
    account = fallback.data as ClientAccountRow | null;
    accountError = fallback.error;
  }

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
    hasLogo: Boolean(relatedClient?.logo_object_key),
    logoUpdatedAt: relatedClient?.logo_updated_at || null,
    status: account.status as ClientSession["status"],
  };
});

export const getClientModules = cache(async (userId: string): Promise<ClientModule[]> => {
  const { data, error } = await createAdminClient()
    .from("client_module_access")
    .select("access_mode, solution_modules!inner(id, code, name, description, category, features, sort_order)")
    .eq("account_user_id", userId)
    .order("sort_order", { referencedTable: "solution_modules" });

  if (error) return [];
  return (data || []).flatMap((row) => {
    const solution = Array.isArray(row.solution_modules)
      ? row.solution_modules[0]
      : row.solution_modules;
    if (!solution) return [];
    return [{
      id: solution.id,
      code: solution.code,
      name: solution.name,
      description: solution.description,
      category: solution.category,
      features: Array.isArray(solution.features)
        ? solution.features.filter((feature): feature is string => typeof feature === "string")
        : [],
      sortOrder: Number(solution.sort_order),
      accessMode: row.access_mode,
    }];
  });
});

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

  return client;
}

export async function requireClientModule(moduleCode: string) {
  const client = await requireClient();
  const solution = (await getClientModules(client.userId))
    .find((entry) => entry.code === moduleCode);

  if (!solution) redirect("/portal");

  return { client, moduleAccess: { access_mode: solution.accessMode, module: solution } };
}
