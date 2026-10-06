import Link from "next/link";
import { connection } from "next/server";
import { AdminIcon } from "@/components/admin/admin-icon";
import { StatusPill } from "@/components/admin/status-pill";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";

const peso = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  maximumFractionDigits: 0,
});

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "Asia/Manila",
  }).format(new Date(value));
}

export default async function AdminOverviewPage() {
  await connection();
  await requireAdmin({ touch: false });
  const supabase = createAdminClient();
  const today = new Intl.DateTimeFormat("en-PH", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "Asia/Manila",
  }).format(new Date());

  const [inquiriesResult, clientsResult, subscriptionsResult, plansResult] = await Promise.all([
    supabase
      .from("consultation_requests")
      .select("id, name, business_name, email, status, created_at")
      .order("created_at", { ascending: false })
      .limit(40),
    supabase
      .from("clients")
      .select("id, business_name, status, created_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("client_subscriptions")
      .select("id, status, amount_centavos, renews_at, client_id, plan_id")
      .in("status", ["trial", "active", "past_due", "paused"]),
    supabase
      .from("subscription_plans")
      .select("id, billing_interval"),
  ]);

  const inquiries = inquiriesResult.data || [];
  const clients = clientsResult.data || [];
  const subscriptions = subscriptionsResult.data || [];
  const billingIntervals = new Map(
    (plansResult.data || []).map((plan) => [plan.id, plan.billing_interval]),
  );
  const newInquiries = inquiries.filter((item) => item.status === "new").length;
  const activeClients = clients.filter((item) => item.status === "active").length;
  const followUps = inquiries.filter((item) => ["new", "contacted", "qualified"].includes(item.status)).length;
  const monthlyRevenue = subscriptions
    .filter((item) => item.status === "active")
    .reduce((sum, item) => {
      const amount = (item.amount_centavos || 0) / 100;
      return sum + (billingIntervals.get(item.plan_id) === "yearly" ? amount / 12 : amount);
    }, 0);
  const pipeline = ["new", "contacted", "qualified", "closed"].map((status) => ({
    status,
    count: inquiries.filter((item) => item.status === status).length,
  }));
  const maxPipeline = Math.max(...pipeline.map((item) => item.count), 1);
  const clientNames = new Map(clients.map((client) => [client.id, client.business_name]));
  const upcomingRenewals = subscriptions
    .filter((item) => item.renews_at)
    .sort((a, b) => String(a.renews_at).localeCompare(String(b.renews_at)))
    .slice(0, 4);

  return (
    <div className="admin-page">
      <header className="admin-page-header">
        <div><p className="admin-eyebrow">{today}</p><h1>Here’s what needs attention.</h1><p>A clear view of leads, clients, and recurring business.</p></div>
        <Link className="admin-primary-button" href="/admin/clients#new-client"><AdminIcon name="plus" /> Add client</Link>
      </header>

      {(inquiriesResult.error || clientsResult.error || subscriptionsResult.error || plansResult.error) && (
        <div className="admin-setup-banner"><strong>Finish database setup</strong><span>Run the admin workspace migration in Supabase to activate live metrics.</span></div>
      )}

      <section className="admin-metric-grid" aria-label="Business summary">
        <article className="admin-metric-card coral"><span>New inquiries</span><strong>{newInquiries}</strong><small>Waiting for first response</small></article>
        <article className="admin-metric-card"><span>Active clients</span><strong>{activeClients}</strong><small>{clients.length} total client records</small></article>
        <article className="admin-metric-card"><span>Tracked MRR</span><strong>{peso.format(monthlyRevenue)}</strong><small>From active subscriptions</small></article>
        <article className="admin-metric-card dark"><span>Open follow-ups</span><strong>{followUps}</strong><small>Across the sales pipeline</small></article>
      </section>

      <section className="admin-overview-grid">
        <article className="admin-panel admin-leads-panel">
          <div className="admin-panel-heading"><div><p className="admin-eyebrow">Lead inbox</p><h2>Recent inquiries</h2></div><Link href="/admin/inquiries">View all <AdminIcon name="arrow" size={16} /></Link></div>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>Lead</th><th>Status</th><th>Received</th></tr></thead>
              <tbody>
                {inquiries.slice(0, 6).map((inquiry) => (
                  <tr key={inquiry.id}>
                    <td><strong>{inquiry.business_name}</strong><span>{inquiry.name} · {inquiry.email}</span></td>
                    <td><StatusPill status={inquiry.status} /></td>
                    <td>{formatDate(inquiry.created_at)}</td>
                  </tr>
                ))}
                {!inquiries.length && <tr><td colSpan={3} className="admin-empty-cell">New consultation requests will appear here.</td></tr>}
              </tbody>
            </table>
          </div>
        </article>

        <aside className="admin-panel admin-pipeline-panel">
          <div className="admin-panel-heading"><div><p className="admin-eyebrow">Conversion</p><h2>Inquiry pipeline</h2></div></div>
          <div className="admin-pipeline-list">
            {pipeline.map((item) => (
              <div key={item.status} className="admin-pipeline-row">
                <div><span>{item.status}</span><strong>{item.count}</strong></div>
                <span className="admin-pipeline-track"><span style={{ width: `${Math.max((item.count / maxPipeline) * 100, item.count ? 8 : 0)}%` }} /></span>
              </div>
            ))}
          </div>
        </aside>

        <aside className="admin-panel admin-renewal-panel">
          <div className="admin-panel-heading"><div><p className="admin-eyebrow">Revenue care</p><h2>Upcoming renewals</h2></div><Link href="/admin/clients">Manage</Link></div>
          <div className="admin-renewal-list">
            {upcomingRenewals.map((subscription) => (
              <div key={subscription.id}>
                <span className="admin-renewal-icon"><AdminIcon name="calendar" /></span>
                <span><strong>{clientNames.get(subscription.client_id) || "Client"}</strong><small>{subscription.renews_at ? formatDate(subscription.renews_at) : "No renewal date"}</small></span>
                <strong>{peso.format((subscription.amount_centavos || 0) / 100)}</strong>
              </div>
            ))}
            {!upcomingRenewals.length && <p className="admin-empty-copy">Assign a plan to a client and its renewal will appear here.</p>}
          </div>
        </aside>

        <article className="admin-panel admin-focus-panel">
          <span className="admin-focus-icon"><AdminIcon name="spark" size={24} /></span>
          <div><p className="admin-eyebrow">Today’s focus</p><h2>{newInquiries ? `Respond to ${newInquiries} new ${newInquiries === 1 ? "lead" : "leads"}.` : "Your lead inbox is clear."}</h2><p>{newInquiries ? "Fast, thoughtful follow-up is the simplest conversion advantage." : "Use the time to review renewals or nurture qualified prospects."}</p></div>
          <Link href="/admin/inquiries"><AdminIcon name="arrow" /></Link>
        </article>
      </section>
    </div>
  );
}
