"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { clientLogoutAction } from "@/app/(client-auth)/actions";
import type { ClientSession } from "@/lib/client-auth";

export function ClientPortalSidebar({
  client,
  modules,
}: {
  client: ClientSession;
  modules: Array<{ code: string; name: string }>;
}) {
  const pathname = usePathname();
  const initials = client.businessName.slice(0, 2).toUpperCase();

  return (
    <aside className="client-sidebar">
      <Link className="client-portal-brand" href="/portal">
        <span><Image src="/ezpztek-logo.png" alt="" width={32} height={32} /></span>
        <strong>EZPZTEK</strong>
      </Link>
      {client.status === "approved" && (
        <nav aria-label="Client workspace">
          <p>Workspace</p>
          <Link href="/portal" className={pathname === "/portal" ? "active" : ""}>Overview</Link>
          {modules.map((module) => {
            const href = `/portal/modules/${module.code}`;
            return <Link href={href} className={pathname === href ? "active" : ""} key={module.code}>{module.name}</Link>;
          })}
        </nav>
      )}
      <div className="client-sidebar-foot">
        <span className="client-company-avatar">{initials}</span>
        <span><strong>{client.businessName}</strong><small>{client.displayName}</small></span>
        <form action={clientLogoutAction}><button type="submit">Sign out</button></form>
      </div>
    </aside>
  );
}
