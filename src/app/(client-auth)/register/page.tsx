import { createHash } from "node:crypto";
import Image from "next/image";
import Link from "next/link";
import { ClientRegistrationForm } from "@/components/client-auth-forms";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata = {
  title: "Create client access",
  robots: { index: false, follow: false },
};

export default async function ClientRegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : "";
  const tokenHash = token
    ? createHash("sha256").update(token).digest("hex")
    : "";
  const supabase = createAdminClient();
  const { data: invitation } = tokenHash
    ? await supabase
        .from("client_invitations")
        .select("status, expires_at, clients!inner(business_name, contact_name)")
        .eq("token_hash", tokenHash)
        .eq("status", "pending")
        .maybeSingle()
    : { data: null };
  const isValid = Boolean(
    invitation && new Date(invitation.expires_at) > new Date(),
  );
  const relatedClient = invitation
    ? Array.isArray(invitation.clients)
      ? invitation.clients[0]
      : invitation.clients
    : null;

  return (
    <main className="client-auth-page register">
      <section className="client-auth-visual">
        <Link href="/" className="client-brand"><span><Image src="/ezpztek-logo.png" alt="" width={36} height={36} /></span>EZPZTEK</Link>
        <div>
          <p className="client-kicker">Private invitation</p>
          <h1>Start simple.<br /><em>Grow with clarity.</em></h1>
          <p>Your account keeps the business modules selected for you in one secure place.</p>
        </div>
        <small>Invitation links are single-use and expire automatically.</small>
      </section>
      <section className="client-auth-panel">
        <div className="client-auth-card">
          {isValid && relatedClient ? (
            <>
              <p className="client-kicker">Create credentials</p>
              <h2>Welcome, {relatedClient.business_name}</h2>
              <p>Set your password first. EZPZTEK will then review and approve your free-demo modules.</p>
              <ClientRegistrationForm token={token} defaultName={relatedClient.contact_name} />
            </>
          ) : (
            <div className="client-invalid-invite">
              <span>!</span>
              <p className="client-kicker">Invitation unavailable</p>
              <h2>This link cannot be used.</h2>
              <p>It may have expired, already been accepted, or been replaced by a newer invitation.</p>
              <Link className="client-primary-button" href="/login">Go to client login</Link>
            </div>
          )}
          <Link className="client-back-link" href="/">← Return to EZPZTEK</Link>
        </div>
      </section>
    </main>
  );
}
