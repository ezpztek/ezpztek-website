import { StatusPill } from "@/components/admin/status-pill";
import { connection } from "next/server";
import { SubmitButton } from "@/components/admin/submit-button";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { updatePlanAction } from "../../actions";

function priceInPesos(centavos: number | null) {
  return centavos === null ? "" : String(centavos / 100);
}

export default async function PlansPage() {
  await connection();
  await requireAdmin({ touch: false });
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("subscription_plans")
    .select("id, code, name, description, price_centavos, billing_interval, features, is_active")
    .order("sort_order");
  const plans = data || [];

  return (
    <div className="admin-page">
      <header className="admin-page-header compact">
        <div><p className="admin-eyebrow">Commercial model</p><h1>Subscription plans</h1><p>Shape clear offers that are easy to sell, deliver, and renew.</p></div>
      </header>
      {error && <div className="admin-setup-banner"><strong>Plan data is unavailable</strong><span>Run the admin migration in Supabase first.</span></div>}
      <section className="admin-plan-grid">
        {plans.map((plan, index) => (
          <article className={`admin-plan-card ${index === 1 ? "featured" : ""}`} key={plan.id}>
            <div className="admin-plan-card-top"><span className="admin-plan-number">0{index + 1}</span><StatusPill status={plan.is_active ? "active" : "paused"} /></div>
            <form action={updatePlanAction}>
              <input type="hidden" name="id" value={plan.id} />
              <label>Plan name<input name="name" defaultValue={plan.name} required /></label>
              <label>Description<textarea name="description" defaultValue={plan.description} rows={3} /></label>
              <div className="admin-form-row"><label>Price in pesos<input name="pricePesos" type="number" min="0" step="1" defaultValue={priceInPesos(plan.price_centavos)} placeholder="Custom" /></label><label>Billing<select name="billingInterval" defaultValue={plan.billing_interval}><option value="monthly">Monthly</option><option value="yearly">Yearly</option><option value="custom">Custom</option></select></label></div>
              <label>Features <small>One per line</small><textarea name="features" defaultValue={Array.isArray(plan.features) ? plan.features.join("\n") : ""} rows={5} /></label>
              <label className="admin-checkbox"><input type="checkbox" name="isActive" defaultChecked={plan.is_active} /><span>Available for new subscriptions</span></label>
              <SubmitButton>Save plan</SubmitButton>
            </form>
          </article>
        ))}
      </section>
      <section className="admin-pricing-note"><span>Pricing note</span><p>These are internal draft offers. Confirm inclusions, taxes, support boundaries, and onboarding fees before publishing them to customers.</p></section>
    </div>
  );
}
