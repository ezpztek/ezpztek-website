"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
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
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const previousOverflow = document.body.style.overflow;
    const desktopQuery = window.matchMedia("(min-width: 801px)");
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    function onViewportChange(event: MediaQueryListEvent) {
      if (event.matches) setMenuOpen(false);
    }

    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(sidebarRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? []).filter((element) => element.offsetParent !== null);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    desktopQuery.addEventListener("change", onViewportChange);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      desktopQuery.removeEventListener("change", onViewportChange);
    };
  }, [menuOpen]);

  function closeMenu({ restoreFocus = false } = {}) {
    setMenuOpen(false);
    if (restoreFocus) window.requestAnimationFrame(() => menuButtonRef.current?.focus());
  }

  return (
    <>
      <header className="client-mobile-header">
        <Link className="client-mobile-brand" href="/portal">
          <span><Image src="/ezpztek-logo.png" alt="" width={28} height={28} /></span>
          <span><strong>EZPZTEK</strong><small>{client.businessName}</small></span>
        </Link>
        <button
          ref={menuButtonRef}
          type="button"
          className="client-menu-button"
          aria-label="Open workspace menu"
          aria-controls="client-workspace-sidebar"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(true)}
        >
          <span /><span /><span />
        </button>
      </header>

      {menuOpen && (
        <button
          type="button"
          className="client-sidebar-backdrop"
          aria-label="Close workspace menu"
          onClick={() => closeMenu({ restoreFocus: true })}
        />
      )}

      <aside
        ref={sidebarRef}
        id="client-workspace-sidebar"
        className={`client-sidebar ${menuOpen ? "mobile-open" : ""}`}
      >
        <div className="client-sidebar-head">
          <Link className="client-portal-brand" href="/portal" onClick={() => closeMenu()}>
            <span><Image src="/ezpztek-logo.png" alt="" width={32} height={32} /></span>
            <strong>EZPZTEK</strong>
          </Link>
          <button
            ref={closeButtonRef}
            type="button"
            className="client-sidebar-close"
            aria-label="Close workspace menu"
            onClick={() => closeMenu({ restoreFocus: true })}
          >&times;</button>
        </div>
        {client.status === "approved" && (
          <nav aria-label="Client workspace">
            <p>Workspace</p>
            <Link href="/portal" onClick={() => closeMenu()} className={pathname === "/portal" ? "active" : ""}>Overview</Link>
            {modules.map((module) => {
              const href = `/portal/modules/${module.code}`;
              return <Link href={href} onClick={() => closeMenu()} className={pathname === href ? "active" : ""} key={module.code}>{module.name}</Link>;
            })}
            {modules.some((module) => module.code === "pos") && (
              <Link href="/portal/modules/integrations" onClick={() => closeMenu()} className={pathname === "/portal/modules/integrations" ? "active" : ""}>Delivery integrations</Link>
            )}
          </nav>
        )}
        <div className="client-sidebar-foot">
          <span className="client-company-avatar">{initials}</span>
          <span><strong>{client.businessName}</strong><small>{client.displayName}</small></span>
          <form action={clientLogoutAction}><button type="submit">Sign out</button></form>
        </div>
      </aside>
    </>
  );
}
