import type { Metadata } from "next";
import { ClientPortalSidebar } from "@/components/client-portal-sidebar";
import { requireClient } from "@/lib/client-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = {
  title: "Client workspace",
  description: "Your private EZPZTEK business systems workspace.",
  robots: { index: false, follow: false, nocache: true },
};

export default async function ClientPortalLayout({ children }: LayoutProps<"/portal">) {
  const client = await requireClient({ allowPending: true });
  const supabase = createAdminClient();
  const { data: accessRows } = client.status === "approved"
    ? await supabase
        .from("client_module_access")
        .select("solution_modules!inner(code, name, sort_order)")
        .eq("account_user_id", client.userId)
        .order("sort_order", { referencedTable: "solution_modules" })
    : { data: [] };
  const modules = (accessRows || [])
    .map((row) => Array.isArray(row.solution_modules) ? row.solution_modules[0] : row.solution_modules)
    .filter((module): module is { code: string; name: string; sort_order: number } => Boolean(module));
  return (
    <div className="client-portal-root">
      <ClientPortalSidebar client={client} modules={modules} />
      <main className="client-portal-main">{children}</main>
    </div>
  );
}
