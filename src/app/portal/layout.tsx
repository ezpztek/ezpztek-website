import type { Metadata } from "next";
import { ClientPortalSidebar } from "@/components/client-portal-sidebar";
import { getClientModules, requireClient } from "@/lib/client-auth";

export const metadata: Metadata = {
  title: "Client workspace",
  description: "Your private EZPZTEK business systems workspace.",
  robots: { index: false, follow: false, nocache: true },
};

export default async function ClientPortalLayout({ children }: LayoutProps<"/portal">) {
  const client = await requireClient({ allowPending: true });
  const modules = client.status === "approved"
    ? await getClientModules(client.userId)
    : [];
  return (
    <div className="client-portal-root">
      <ClientPortalSidebar client={client} modules={modules} />
      <main className="client-portal-main">{children}</main>
    </div>
  );
}
