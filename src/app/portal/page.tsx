import Link from "next/link";
import { requireClient } from "@/lib/client-auth";
import { createAdminClient } from "@/lib/supabase/admin";

const categoryLabels: Record<string, string> = {
  operations: "Operations",
  sales: "Sales",
  finance: "Finance",
  people: "People",
  insights: "Insights",
};

export default async function ClientPortalPage() {
  const client = await requireClient();
  const supabase = createAdminClient();
  const { data: accessRows } = await supabase
    .from("client_module_access")
    .select("access_mode, granted_at, solution_modules!inner(id, code, name, description, category, features)")
    .eq("account_user_id", client.userId)
    .order("granted_at", { ascending: true });
  const modules = (accessRows || []).map((row) => ({
    accessMode: row.access_mode,
    module: Array.isArray(row.solution_modules)
      ? row.solution_modules[0]
      : row.solution_modules,
  }));

  return (
    <div className="client-dashboard">
      <header className="client-dashboard-head">
        <div><p className="client-kicker">Free demo workspace</p><h1>Good day, {client.displayName.split(" ")[0]}.</h1><p>Your approved business modules are ready to explore.</p></div>
        <span className="client-live-badge"><i /> Demo active</span>
      </header>

      <section className="client-welcome-banner">
        <div><span>EZ</span><div><small>Workspace</small><strong>{client.businessName}</strong></div></div>
        <p>Start with one workflow, test it with real operating scenarios, and tell us what should fit your business better.</p>
      </section>

      <div className="client-section-heading">
        <div><p className="client-kicker">Your solutions</p><h2>Approved modules</h2></div>
        <span>{modules.length} available</span>
      </div>
      <section className="client-module-grid">
        {modules.map(({ module, accessMode }, index) =>
          module ? (
            <Link className="client-module-card" href={`/portal/modules/${module.code}`} key={module.id}>
              <span className="client-module-number">{String(index + 1).padStart(2, "0")}</span>
              <small>{categoryLabels[module.category] || module.category}</small>
              <h3>{module.name}</h3>
              <p>{module.description}</p>
              <div><span>{accessMode} access</span><b>Open →</b></div>
            </Link>
          ) : null,
        )}
      </section>

      <section className="client-help-panel">
        <div><p className="client-kicker">Guided rollout</p><h2>Need help testing a workflow?</h2><p>Send us the real process you want to improve. We’ll shape the demo around how your team actually works.</p></div>
        <a href={`mailto:${process.env.NEXT_PUBLIC_CONTACT_EMAIL || "hello@ezpztek.com"}`}>Contact EZPZTEK</a>
      </section>
    </div>
  );
}

