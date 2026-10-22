import Image from "next/image";
import Link from "next/link";
import { getClientModules, requireClient } from "@/lib/client-auth";
import { formatPeso } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";

type WorkspaceSummary = {
  active_product_count: number | string;
  low_stock_count: number | string;
  out_of_stock_count: number | string;
  inventory_retail_value: number | string;
  today_sales_count: number | string;
  today_sales_total: number | string;
  last_sale_at: string | null;
};

const categoryLabels: Record<string, string> = {
  operations: "Operations",
  sales: "Sales",
  finance: "Finance",
  people: "People",
  insights: "Insights",
};

const phDateTime = new Intl.DateTimeFormat("en-PH", {
  timeZone: "Asia/Manila",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export default async function ClientPortalPage() {
  const client = await requireClient();
  const db = createAdminClient();
  const [modules, summaryResult, salesResult] = await Promise.all([
    getClientModules(client.userId),
    db.rpc("get_client_workspace_summary", { p_client_id: client.clientId }),
    db
      .from("pos_sales")
      .select("id, receipt_number, total_centavos, payment_method, created_at")
      .eq("client_id", client.clientId)
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const summary = summaryResult.data?.[0] as WorkspaceSummary | undefined;
  const moduleCodes = new Set(modules.map((module) => module.code));
  const hasPos = moduleCodes.has("pos");
  const hasInventory = ["inventory", "stock-control", "pos"]
    .some((code) => moduleCodes.has(code));
  const lowStock = Number(summary?.low_stock_count || 0);
  const outOfStock = Number(summary?.out_of_stock_count || 0);
  const logoUrl = client.hasLogo
    ? `/api/client/logo?v=${encodeURIComponent(client.logoUpdatedAt || "current")}`
    : null;

  const quickActions = [
    hasPos && { href: "/portal/modules/pos", label: "Open POS", detail: "Start a new sale" },
    moduleCodes.has("inventory") && {
      href: "/portal/modules/inventory",
      label: "Manage inventory",
      detail: "Add or update items",
    },
    moduleCodes.has("stock-control") && {
      href: "/portal/modules/stock-control",
      label: "Record stock",
      detail: "Receive or adjust quantities",
    },
    { href: "/portal/settings", label: "Workspace settings", detail: "Logo and password" },
  ].filter((action): action is { href: string; label: string; detail: string } => Boolean(action));

  return (
    <div className="client-dashboard client-summary-page">
      <header className="client-dashboard-head client-summary-head">
        <div>
          <p className="client-kicker">Workspace summary</p>
          <h1>Good day, {client.displayName.split(" ")[0]}.</h1>
          <p>Here is what is happening across {client.businessName} today.</p>
        </div>
        <div className="client-summary-business">
          <span className={`client-summary-logo ${logoUrl ? "has-logo" : ""}`}>
            {logoUrl
              ? <Image src={logoUrl} alt={`${client.businessName} logo`} width={44} height={44} unoptimized />
              : client.businessName.slice(0, 2).toUpperCase()}
          </span>
          <span><small>Current workspace</small><strong>{client.businessName}</strong></span>
        </div>
      </header>

      {summaryResult.error && (
        <p className="client-module-error" role="alert">
          Summary totals are not available yet. Apply migration 013, then refresh this page.
        </p>
      )}

      <section className="client-summary-metrics" aria-label="Today at a glance">
        <article>
          <small>Today&apos;s sales</small>
          <strong>{hasPos && summary ? formatPeso(Number(summary.today_sales_total)) : "--"}</strong>
          <span>{hasPos ? "Completed transactions" : "POS is not enabled"}</span>
        </article>
        <article>
          <small>Transactions</small>
          <strong>{hasPos && summary ? Number(summary.today_sales_count).toLocaleString("en-PH") : "--"}</strong>
          <span>{summary?.last_sale_at ? `Last sale ${phDateTime.format(new Date(summary.last_sale_at))}` : "No sales recorded today"}</span>
        </article>
        <article>
          <small>Active items</small>
          <strong>{hasInventory && summary ? Number(summary.active_product_count).toLocaleString("en-PH") : "--"}</strong>
          <span>{hasInventory ? "Available in your catalog" : "Inventory is not enabled"}</span>
        </article>
        <article className={lowStock + outOfStock > 0 ? "needs-attention" : ""}>
          <small>Needs attention</small>
          <strong>{hasInventory && summary ? (lowStock + outOfStock).toLocaleString("en-PH") : "--"}</strong>
          <span>{hasInventory ? `${lowStock} low stock · ${outOfStock} out of stock` : "Stock control is not enabled"}</span>
        </article>
      </section>

      <div className="client-summary-layout">
        <section className="client-summary-panel">
          <div className="client-section-heading">
            <div><p className="client-kicker">Shortcuts</p><h2>Quick actions</h2></div>
          </div>
          <div className="client-quick-actions">
            {quickActions.map((action) => (
              <Link href={action.href} key={action.href}>
                <span><strong>{action.label}</strong><small>{action.detail}</small></span>
                <b aria-hidden="true">→</b>
              </Link>
            ))}
          </div>
        </section>

        <section className="client-summary-panel client-stock-snapshot">
          <div className="client-section-heading">
            <div><p className="client-kicker">Inventory</p><h2>Stock snapshot</h2></div>
            {moduleCodes.has("inventory") && <Link href="/portal/modules/inventory">View items</Link>}
          </div>
          {hasInventory ? (
            <div className="client-stock-summary">
              <span><small>Low stock</small><strong>{summary ? lowStock : "--"}</strong></span>
              <span><small>Out of stock</small><strong>{summary ? outOfStock : "--"}</strong></span>
              <span><small>Retail value</small><strong>{summary ? formatPeso(Number(summary.inventory_retail_value)) : "--"}</strong></span>
            </div>
          ) : <p className="client-summary-empty">Inventory totals will appear when that module is enabled.</p>}
        </section>

        {hasPos && (
          <section className="client-summary-panel client-recent-activity">
            <div className="client-section-heading">
              <div><p className="client-kicker">Activity</p><h2>Recent sales</h2></div>
              <Link href="/portal/modules/pos">Open POS</Link>
            </div>
            <div className="client-summary-sales">
              {(salesResult.data || []).map((sale) => (
                <article key={sale.id}>
                  <span><strong>{sale.receipt_number}</strong><small>{phDateTime.format(new Date(sale.created_at))} · {sale.payment_method}</small></span>
                  <b>{formatPeso(Number(sale.total_centavos))}</b>
                </article>
              ))}
              {!salesResult.data?.length && <p className="client-summary-empty">No completed sales yet.</p>}
            </div>
          </section>
        )}

        <section className="client-summary-panel client-enabled-modules">
          <div className="client-section-heading">
            <div><p className="client-kicker">Access</p><h2>Your modules</h2></div>
            <span>{modules.length} enabled</span>
          </div>
          <div className="client-summary-modules">
            {modules.map((module) => (
              <Link href={`/portal/modules/${module.code}`} key={module.id}>
                <span><small>{categoryLabels[module.category] || module.category}</small><strong>{module.name}</strong></span>
                <b>{module.accessMode}</b>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
