import { AdminIcon } from "@/components/admin/admin-icon";
import { connection } from "next/server";
import { StatusPill } from "@/components/admin/status-pill";
import { SubmitButton } from "@/components/admin/submit-button";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { assignSubscriptionAction, createClientAction, updateClientStatusAction } from "../../actions";

const clientStatuses = ["lead", "onboarding", "active", "paused", "cancelled"];

function formatMoney(centavos: number | null) {
  if (centavos === null) return "Custom";
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 }).format(centavos / 100);
}

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string; subscription?: string }>;
}) {
  await connection();
  await requireAdmin({ touch: false });
  const params = await searchParams;
  const supabase = createAdminClient();
  const [clientsResult, plansResult, subscriptionsResult] = await Promise.all([
    supabase.from("clients").select("id, business_name, contact_name, contact_email, contact_phone, website, status, notes, created_at").order("created_at", { ascending: false }),
    supabase.from("subscription_plans").select("id, name, price_centavos, billing_interval, is_active").eq("is_active", true).order("sort_order"),
    supabase.from("client_subscriptions").select("id, client_id, plan_id, status, amount_centavos, starts_at, renews_at").in("status", ["trial", "active", "past_due", "paused"]),
  ]);

  const clients = clientsResult.data || [];
  const plans = plansResult.data || [];
  const subscriptions = subscriptionsResult.data || [];
  const planMap = new Map(plans.map((plan) => [plan.id, plan]));
  const subscriptionMap = new Map(subscriptions.map((subscription) => [subscription.client_id, subscription]));
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="admin-page">
      <header className="admin-page-header compact">
        <div><p className="admin-eyebrow">Customer success</p><h1>Clients & subscriptions</h1><p>Keep account ownership, plan health, and renewals in one place.</p></div>
        <a className="admin-primary-button" href="#new-client"><AdminIcon name="plus" /> Add client</a>
      </header>

      {(params.created || params.subscription) && <div className="admin-success-banner"><strong>{params.created ? "Client added." : "Subscription assigned."}</strong><span>Your workspace is up to date.</span></div>}
      {(clientsResult.error || plansResult.error || subscriptionsResult.error) && <div className="admin-setup-banner"><strong>Client data is unavailable</strong><span>Run the admin migration in Supabase first.</span></div>}

      <section className="admin-client-layout">
        <div className="admin-client-list">
          {clients.map((client) => {
            const subscription = subscriptionMap.get(client.id);
            const plan = subscription ? planMap.get(subscription.plan_id) : null;
            return (
              <details className="admin-client-card" key={client.id}>
                <summary>
                  <span className="admin-client-logo">{client.business_name.slice(0, 2).toUpperCase()}</span>
                  <span className="admin-client-name"><strong>{client.business_name}</strong><small>{client.contact_name} · {client.contact_email}</small></span>
                  <span className="admin-client-plan"><small>Current plan</small><strong>{plan?.name || "No plan"}</strong></span>
                  <StatusPill status={client.status} />
                  <span className="admin-details-arrow"><AdminIcon name="arrow" /></span>
                </summary>
                <div className="admin-client-body">
                  <div className="admin-client-details">
                    <div><small>Contact</small><a href={`mailto:${client.contact_email}`}>{client.contact_email}</a><span>{client.contact_phone || "No phone added"}</span></div>
                    <div><small>Subscription</small><strong>{plan ? `${plan.name} · ${formatMoney(subscription?.amount_centavos ?? null)}` : "Not assigned"}</strong><span>{subscription?.renews_at ? `Renews ${subscription.renews_at}` : "No renewal scheduled"}</span></div>
                    {client.notes && <div className="wide"><small>Internal notes</small><p>{client.notes}</p></div>}
                  </div>
                  <div className="admin-client-actions">
                    <form action={updateClientStatusAction}>
                      <input type="hidden" name="id" value={client.id} />
                      <label>Client status<select name="status" defaultValue={client.status}>{clientStatuses.map((status) => <option key={status} value={status}>{status}</option>)}</select></label>
                      <SubmitButton>Update status</SubmitButton>
                    </form>
                    <form action={assignSubscriptionAction}>
                      <input type="hidden" name="clientId" value={client.id} />
                      <label>Plan<select name="planId" defaultValue={subscription?.plan_id || ""} required><option value="" disabled>Select a plan</option>{plans.map((item) => <option key={item.id} value={item.id}>{item.name} · {formatMoney(item.price_centavos)}</option>)}</select></label>
                      <div className="admin-form-row"><label>Status<select name="subscriptionStatus" defaultValue={subscription?.status || "active"}><option value="trial">Trial</option><option value="active">Active</option><option value="past_due">Past due</option><option value="paused">Paused</option></select></label><label>Starts<input type="date" name="startsAt" defaultValue={today} required /></label></div>
                      <SubmitButton pendingLabel="Assigning…">Assign plan</SubmitButton>
                    </form>
                  </div>
                </div>
              </details>
            );
          })}
          {!clients.length && <div className="admin-empty-state"><span><AdminIcon name="clients" size={26} /></span><h2>Your client book starts here</h2><p>Add the first client, then assign a recurring plan.</p></div>}
        </div>

        <aside className="admin-panel admin-new-client" id="new-client">
          <p className="admin-eyebrow">New relationship</p><h2>Add a client</h2><p>Capture the account owner and operating context first. A plan can be assigned immediately after.</p>
          <form action={createClientAction}>
            <label>Business name<input name="businessName" placeholder="Acme Trading" required minLength={2} /></label>
            <label>Contact person<input name="contactName" placeholder="Juan Dela Cruz" required minLength={2} /></label>
            <label>Email<input name="contactEmail" type="email" placeholder="juan@company.com" required /></label>
            <div className="admin-form-row"><label>Phone<input name="contactPhone" type="tel" placeholder="+63 9XX XXX XXXX" /></label><label>Website<input name="website" type="url" placeholder="https://" /></label></div>
            <label>Notes<textarea name="notes" rows={3} placeholder="Goals, rollout context, decision-makers…" /></label>
            <SubmitButton className="admin-primary-button" pendingLabel="Adding client…"><AdminIcon name="plus" /> Add client</SubmitButton>
          </form>
        </aside>
      </section>
    </div>
  );
}
