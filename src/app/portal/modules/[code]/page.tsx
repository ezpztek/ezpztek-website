import Link from "next/link";
import { notFound } from "next/navigation";
import { getClientModules, requireClient } from "@/lib/client-auth";

export default async function ClientModulePage({ params }: { params: Promise<{ code: string }> }) {
  const client = await requireClient();
  const { code } = await params;
  const solutionModule = (await getClientModules(client.userId))
    .find((module) => module.code === code);
  if (!solutionModule) notFound();
  const features = solutionModule.features;

  return (
    <div className="client-module-page">
      <Link href="/portal" className="client-module-back">← All modules</Link>
      <header>
        <div><p className="client-kicker">{solutionModule.accessMode} module</p><h1>{solutionModule.name}</h1><p>{solutionModule.description}</p></div>
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
