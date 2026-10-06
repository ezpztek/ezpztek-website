import Link from "next/link";
import { redirect } from "next/navigation";
import { requireClient } from "@/lib/client-auth";

export default async function PendingApprovalPage() {
  const client = await requireClient({ allowPending: true });
  if (client.status === "approved") redirect("/portal");

  return (
    <section className="client-pending-page">
      <div className="client-pending-card">
        <span className="client-pending-icon"><span /></span>
        <p className="client-kicker">Credentials created</p>
        <h1>Your request is waiting for admin approval.</h1>
        <p>
          Thanks, {client.displayName}. Your secure account for <strong>{client.businessName}</strong> is ready.
          EZPZTEK will select and approve your free-demo modules next.
        </p>
        <div className="client-pending-steps">
          <span className="done"><b>1</b><span><strong>Credentials created</strong><small>Completed</small></span></span>
          <span className="current"><b>2</b><span><strong>Admin review</strong><small>In progress</small></span></span>
          <span><b>3</b><span><strong>Demo access</strong><small>You’ll receive an email</small></span></span>
        </div>
        <p className="client-pending-note">You can safely close this page. We’ll email you as soon as access is approved.</p>
        <Link href="/">Visit EZPZTEK website</Link>
      </div>
    </section>
  );
}

