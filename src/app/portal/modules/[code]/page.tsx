import Link from "next/link";
import { notFound } from "next/navigation";
import { requireClient } from "@/lib/client-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function ClientModulePage({ params }: { params: Promise<{ code: string }> }) {
  const client = await requireClient();
  const { code } = await params;
  const supabase = createAdminClient();
  const { data: access } = await supabase
    .from("client_module_access")
    .select("access_mode, solution_modules!inner(code, name, description, category, features)")
    .eq("account_user_id", client.userId)
    .eq("solution_modules.code", code)
    .maybeSingle();
  const solutionModule = access
    ? Array.isArray(access.solution_modules)
      ? access.solution_modules[0]
      : access.solution_modules
    : null;
  if (!solutionModule) notFound();
  const features = Array.isArray(solutionModule.features)
    ? solutionModule.features.filter((feature): feature is string => typeof feature === "string")
    : [];

  return (
    <div className="client-module-page">
      <Link href="/portal" className="client-module-back">← All modules</Link>
      <header>
        <div><p className="client-kicker">{access?.access_mode} module</p><h1>{solutionModule.name}</h1><p>{solutionModule.description}</p></div>
        <span className="client-live-badge"><i /> Ready to explore</span>
      </header>
      <section className="client-module-preview">
        <div>
          <p className="client-kicker">Included in your demo</p>
          <h2>A focused starting point for {client.businessName}.</h2>
          <p>This module shell confirms your approved access. EZPZTEK will configure live forms, records, and reports around your agreed workflow during implementation.</p>
        </div>
        <div className="client-feature-list">
          {features.map((feature, index) => <span key={feature}><b>{String(index + 1).padStart(2, "0")}</b>{feature}</span>)}
        </div>
      </section>
      <section className="client-demo-notice"><strong>Demo workspace</strong><p>No production data is connected yet. This keeps evaluation safe while we confirm your requirements and access rules.</p></section>
    </div>
  );
}
