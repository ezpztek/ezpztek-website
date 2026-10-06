import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ClientLoginForm } from "@/components/client-auth-forms";
import { getClientSession } from "@/lib/client-auth";

export const metadata = {
  title: "Client login",
  robots: { index: false, follow: false },
};

export default async function ClientLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ registered?: string; access?: string }>;
}) {
  const session = await getClientSession();
  if (session?.status === "approved") redirect("/portal");
  if (session?.status === "pending") redirect("/portal/pending");
  const params = await searchParams;

  return (
    <main className="client-auth-page">
      <section className="client-auth-visual">
        <Link href="/" className="client-brand"><span><Image src="/ezpztek-logo.png" alt="" width={36} height={36} /></span>EZPZTEK</Link>
        <div>
          <p className="client-kicker">Client workspace</p>
          <h1>Your business.<br /><em>One clear view.</em></h1>
          <p>Access the tools, demo modules, and implementation updates selected for your business.</p>
        </div>
        <small>Secure access powered by Supabase Auth</small>
      </section>
      <section className="client-auth-panel">
        <div className="client-auth-card">
          <p className="client-kicker">Welcome back</p>
          <h2>Sign in to your workspace</h2>
          <p>Use the credentials you created from your private EZPZTEK invitation.</p>
          {params.registered && <p className="client-form-success">Credentials created. Sign in while your demo awaits approval.</p>}
          {params.access === "unavailable" && <p className="client-form-error">This workspace is currently unavailable. Please contact EZPZTEK.</p>}
          <ClientLoginForm />
          <p className="client-auth-help">Need help? Contact <a href={`mailto:${process.env.NEXT_PUBLIC_CONTACT_EMAIL || "hello@ezpztek.com"}`}>{process.env.NEXT_PUBLIC_CONTACT_EMAIL || "EZPZTEK support"}</a>.</p>
          <Link className="client-back-link" href="/">← Return to EZPZTEK</Link>
        </div>
      </section>
    </main>
  );
}

