"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutAction } from "@/app/admin/actions";
import type { AdminSession } from "@/lib/admin-auth";
import { AdminIcon } from "./admin-icon";

const navItems = [
  { href: "/admin", label: "Overview", icon: "dashboard" as const },
  { href: "/admin/inquiries", label: "Inquiries", icon: "inquiries" as const },
  { href: "/admin/clients", label: "Clients", icon: "clients" as const },
  { href: "/admin/access", label: "Client access", icon: "arrow" as const },
  { href: "/admin/plans", label: "Plans", icon: "plans" as const },
];

export function AdminSidebar({ admin }: { admin: AdminSession }) {
  const pathname = usePathname();
  const initials = admin.displayName
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <aside className="admin-sidebar">
      <Link className="admin-brand" href="/admin">
        <span className="admin-brand-mark">
          <Image src="/ezpztek-logo.png" alt="" width={34} height={34} />
        </span>
        <span><strong>EZPZTEK</strong><small>Control room</small></span>
      </Link>

      <nav className="admin-nav" aria-label="Admin workspace">
        <p>Workspace</p>
        {navItems.map((item) => {
          const active = item.href === "/admin" ? pathname === item.href : pathname.startsWith(item.href);
          return (
            <Link key={item.href} href={item.href} className={active ? "active" : ""}>
              <AdminIcon name={item.icon} />
              <span>{item.label}</span>
              {active && <span className="admin-nav-indicator" />}
            </Link>
          );
        })}
      </nav>

      <div className="admin-sidebar-foot">
        <div className="admin-profile">
          <span className="admin-avatar">{initials}</span>
          <span><strong>{admin.displayName}</strong><small>{admin.role}</small></span>
        </div>
        <form action={logoutAction}>
          <button className="admin-logout" type="submit" aria-label="Sign out">
            <AdminIcon name="logout" />
          </button>
        </form>
      </div>
    </aside>
  );
}
