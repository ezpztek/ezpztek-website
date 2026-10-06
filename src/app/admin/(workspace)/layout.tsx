import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { requireAdmin } from "@/lib/admin-auth";

export default async function AdminWorkspaceLayout({ children }: LayoutProps<"/admin">) {
  const admin = await requireAdmin();

  return (
    <div className="admin-shell">
      <AdminSidebar admin={admin} />
      <main className="admin-main">{children}</main>
    </div>
  );
}

