import "server-only";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";

export async function getClientBranch(clientId: string, requested?: string) {
  const { data, error } = await createAdminClient().from("client_branches")
    .select("id,name,is_primary").eq("client_id", clientId).eq("is_active", true)
    .order("is_primary", { ascending: false }).order("name");
  if (error) throw new Error("BRANCH_MIGRATION_REQUIRED");
  const branches = data || [];
  const branch = requested ? branches.find((item) => item.id === requested) : branches[0];
  if (!branch) notFound();
  return { branch, branches };
}
