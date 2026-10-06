import { connection } from "next/server";
import { AdminIcon } from "@/components/admin/admin-icon";
import { StatusPill } from "@/components/admin/status-pill";
import { SubmitButton } from "@/components/admin/submit-button";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { approveClientAccessAction, inviteClientAction } from "./actions";

function formatDate(value: string | null) {
  if (!value) return "Not yet";
  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "Asia/Manila",
  }).format(new Date(value));
}

export default async function ClientAccessPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string; approval?: string; access?: string }>;
}) {
  await connection();
  await requireAdmin({ touch: false });
  const params = await searchParams;
  const supabase = createAdminClient();

  const [clientsResult, accountsResult, invitationsResult, modulesResult, accessResult] =
    await Promise.all([
      supabase
        .from("clients")
        .select("id, business_name, contact_name, contact_email, status")
        .neq("status", "cancelled")
        .order("created_at", { ascending: false }),
      supabase
        .from("client_portal_accounts")
        .select("user_id, client_id, display_name, status, registered_at, approved_at"),
      supabase
        .from("client_invitations")
        .select("id, client_id, status, email_status, expires_at, created_at")
        .order("created_at", { ascending: false }),
      supabase
        .from("solution_modules")
        .select("id, code, name, description, category")
        .eq("is_active", true)
        .order("sort_order"),
      supabase.from("client_module_access").select("account_user_id, module_id"),
    ]);

  const clients = clientsResult.data || [];
  const accounts = accountsResult.data || [];
  const invitations = invitationsResult.data || [];
  const modules = modulesResult.data || [];
  const moduleAccess = accessResult.data || [];
  const accountByClient = new Map(accounts.map((account) => [account.client_id, account]));
  const latestInviteByClient = new Map<string, (typeof invitations)[number]>();
  invitations.forEach((invitation) => {
    if (!latestInviteByClient.has(invitation.client_id)) {
      latestInviteByClient.set(invitation.client_id, invitation);
    }
  });
  const moduleIdsByAccount = new Map<string, Set<string>>();
  moduleAccess.forEach((access) => {
    const current = moduleIdsByAccount.get(access.account_user_id) || new Set<string>();
    current.add(access.module_id);
    moduleIdsByAccount.set(access.account_user_id, current);
  });
  const pendingCount = accounts.filter((account) => account.status === "pending").length;
  const approvedCount = accounts.filter((account) => account.status === "approved").length;

  const hasSetupError = [
    clientsResult.error,
    accountsResult.error,
    invitationsResult.error,
    modulesResult.error,
    accessResult.error,
  ].some(Boolean);

  return (
    <div className="admin-page">
      <header className="admin-page-header compact">
        <div>
          <p className="admin-eyebrow">Client onboarding</p>
          <h1>Access & demo approvals</h1>
          <p>Invite clients, review registrations, and unlock only the business modules they need.</p>
        </div>
        <div className="admin-access-summary">
          <span><strong>{pendingCount}</strong> awaiting approval</span>
          <span><strong>{approvedCount}</strong> active workspaces</span>
        </div>
      </header>

      {hasSetupError && (
        <div className="admin-setup-banner">
          <strong>Client portal setup required</strong>
          <span>Run migration 202610060004 in the Supabase SQL Editor.</span>
        </div>
      )}
      {params.invite === "sent" && <div className="admin-success-banner"><strong>Invitation sent.</strong><span>The private credential link expires in seven days.</span></div>}
      {params.invite === "failed" && <div className="admin-setup-banner"><strong>Invitation saved, but email failed.</strong><span>Check the Hostinger SMTP settings, then resend the invitation.</span></div>}
      {params.approval === "sent" && <div className="admin-success-banner"><strong>Free demo approved.</strong><span>The client received their login link and selected modules.</span></div>}
      {params.approval === "email-failed" && <div className="admin-setup-banner"><strong>Access approved, but email failed.</strong><span>The client can still sign in at /login.</span></div>}
      {params.access === "updated" && <div className="admin-success-banner"><strong>Module access updated.</strong><span>The client workspace now reflects the new selection.</span></div>}

      <section className="admin-access-list">
        {clients.map((client) => {
          const account = accountByClient.get(client.id);
          const invitation = latestInviteByClient.get(client.id);
          const selectedModuleIds = account
            ? moduleIdsByAccount.get(account.user_id) || new Set<string>()
            : new Set<string>();
          const inviteExpired = invitation
            ? new Date(invitation.expires_at) <= new Date()
            : false;

          return (
            <article className="admin-access-card" key={client.id}>
              <div className="admin-access-card-head">
                <span className="admin-client-logo">{client.business_name.slice(0, 2).toUpperCase()}</span>
                <div>
                  <h2>{client.business_name}</h2>
                  <p>{client.contact_name} · {client.contact_email}</p>
                </div>
                <StatusPill status={account?.status || (invitation?.status === "pending" ? "invited" : "not invited")} />
              </div>

              {!account ? (
                <div className="admin-invite-state">
                  <div>
                    <strong>{invitation?.status === "pending" && !inviteExpired ? "Credential invitation pending" : "Ready to invite"}</strong>
                    <p>
                      {invitation?.status === "pending" && !inviteExpired
                        ? `Sent ${formatDate(invitation.created_at)} · Email ${invitation.email_status}`
                        : "Send a private one-time link so the client can create their password."}
                    </p>
                  </div>
                  <form action={inviteClientAction}>
                    <input type="hidden" name="clientId" value={client.id} />
                    <SubmitButton className="admin-primary-button" pendingLabel="Sending…">
                      <AdminIcon name="arrow" size={16} />
                      {invitation?.status === "pending" && !inviteExpired ? "Resend invite" : "Send invite"}
                    </SubmitButton>
                  </form>
                </div>
              ) : (
                <form className="admin-approval-form" action={approveClientAccessAction}>
                  <input type="hidden" name="accountUserId" value={account.user_id} />
                  <div className="admin-account-timeline">
                    <span><small>Credentials created</small><strong>{formatDate(account.registered_at)}</strong></span>
                    <span><small>Demo approved</small><strong>{formatDate(account.approved_at)}</strong></span>
                  </div>
                  <div className="admin-module-heading">
                    <div><strong>Choose solution modules</strong><p>Select one or several. The client sees only approved modules.</p></div>
                    <span>{selectedModuleIds.size} selected</span>
                  </div>
                  <div className="admin-module-picker">
                    {modules.map((module) => (
                      <label key={module.id}>
                        <input
                          type="checkbox"
                          name="moduleIds"
                          value={module.id}
                          defaultChecked={selectedModuleIds.has(module.id)}
                        />
                        <span><strong>{module.name}</strong><small>{module.description}</small></span>
                      </label>
                    ))}
                  </div>
                  <div className="admin-approval-foot">
                    <p>{account.status === "pending" ? "Approval sends the congratulations email automatically." : "Saving updates the modules immediately."}</p>
                    <SubmitButton className="admin-primary-button" pendingLabel={account.status === "pending" ? "Approving…" : "Saving…"}>
                      {account.status === "pending" ? "Approve free demo" : "Update access"}
                    </SubmitButton>
                  </div>
                </form>
              )}
            </article>
          );
        })}

        {!clients.length && (
          <div className="admin-empty-state">
            <span><AdminIcon name="clients" size={26} /></span>
            <h2>Add a client first</h2>
            <p>Client records from the Clients page will appear here for invitation.</p>
          </div>
        )}
      </section>
    </div>
  );
}
