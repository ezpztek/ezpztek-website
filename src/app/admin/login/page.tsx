import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/admin/login-form";
import { AdminIcon } from "@/components/admin/admin-icon";
import { getAdminSession } from "@/lib/admin-auth";
import {
  hasAdminConfiguration,
  hasEmergencyPinConfiguration,
} from "@/lib/supabase/config";

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ setup?: string; reset?: string }>;
}) {
  const admin = await getAdminSession();
  if (admin) redirect("/admin");

  const params = await searchParams;
  const configured = hasAdminConfiguration();
  const emergencyPinEnabled = hasEmergencyPinConfiguration();

  return (
    <main className="admin-login-page">
      <section className="admin-login-story">
        <Link className="admin-login-brand" href="/">
          <span><Image src="/ezpztek-logo.png" alt="EZPZTEK" width={42} height={42} /></span>
          EZPZTEK
        </Link>
        <div className="admin-login-story-copy">
          <span className="admin-kicker"><AdminIcon name="spark" size={16} /> Operations, simplified</span>
          <h1>Run the business.<br /><em>See the whole picture.</em></h1>
          <p>One private workspace for leads, client relationships, subscriptions, and the next action that moves revenue forward.</p>
        </div>
        <div className="admin-login-signal">
          <span className="admin-signal-dot" />
          <div><strong>Systems operational</strong><small>Protected by Supabase Auth</small></div>
        </div>
      </section>

      <section className="admin-login-panel">
        <div className="admin-login-card">
          <span className="admin-login-icon"><AdminIcon name="arrow" size={22} /></span>
          <p className="admin-eyebrow">Private access</p>
          <h2>Welcome back</h2>
          <p className="admin-login-intro">Sign in with your authorized EZPZTEK administrator account.</p>
          {(!configured || params.setup) && (
            <div className="admin-setup-notice">
              <strong>One-time setup required</strong>
              <span>Add <code>SUPABASE_PUBLISHABLE_KEY</code>, run the admin migration, then authorize your user.</span>
            </div>
          )}
          {params.reset === "success" && (
            <p className="admin-form-success">Password updated. Sign in with your new password.</p>
          )}
          <LoginForm emergencyPinEnabled={emergencyPinEnabled} />
          <Link className="admin-back-link" href="/">← Return to website</Link>
        </div>
      </section>
    </main>
  );
}
