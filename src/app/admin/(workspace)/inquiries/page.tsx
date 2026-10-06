import { AdminIcon } from "@/components/admin/admin-icon";
import { connection } from "next/server";
import { StatusPill } from "@/components/admin/status-pill";
import { SubmitButton } from "@/components/admin/submit-button";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncQualifiedInquiriesAction, updateInquiryAction } from "../../actions";

const statuses = ["all", "new", "contacted", "qualified", "closed", "spam"] as const;

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Manila",
  }).format(new Date(value));
}

export default async function InquiriesPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    q?: string;
    sync?: string;
    processed?: string;
    created?: string;
    linked?: string;
  }>;
}) {
  await connection();
  await requireAdmin({ touch: false });
  const params = await searchParams;
  const selectedStatus = statuses.includes(params.status as (typeof statuses)[number]) ? params.status || "all" : "all";
  const query = (params.q || "").trim().toLowerCase();
  const supabase = createAdminClient();
  const [inquiriesResult, linksResult] = await Promise.all([
    supabase
      .from("consultation_requests")
      .select("id, name, business_name, email, phone, message, status, source, confirmation_status, admin_notes, created_at")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("client_inquiry_links").select("inquiry_id, client_id"),
  ]);
  const data = inquiriesResult.data || [];
  const linkedInquiryIds = new Set((linksResult.data || []).map((link) => link.inquiry_id));

  const inquiries = (data || []).filter((item) => {
    const statusMatches = selectedStatus === "all" || item.status === selectedStatus;
    const searchMatches = !query || [item.name, item.business_name, item.email, item.phone || ""]
      .some((value) => value.toLowerCase().includes(query));
    return statusMatches && searchMatches;
  });

  return (
    <div className="admin-page">
      <header className="admin-page-header compact">
        <div><p className="admin-eyebrow">Lead management</p><h1>Consultation inquiries</h1><p>Turn every serious question into a clear next action.</p></div>
        <div className="admin-inquiry-header-actions">
          <span className="admin-count-chip">{inquiries.length} shown</span>
          <form action={syncQualifiedInquiriesAction}>
            <SubmitButton className="admin-primary-button" pendingLabel="Syncing…">
              <AdminIcon name="clients" size={16} /> Sync qualified inquiries
            </SubmitButton>
          </form>
        </div>
      </header>

      <div className="admin-automation-note">
        <AdminIcon name="spark" size={18} />
        <span><strong>Automatic client creation is on.</strong> Saving an inquiry as Qualified adds it to Clients using the details already provided.</span>
      </div>

      {params.sync === "done" && (
        <div className="admin-success-banner">
          <strong>Qualified inquiries synchronized.</strong>
          <span>{params.processed || "0"} processed · {params.created || "0"} clients created · {params.linked || "0"} linked to existing clients.</span>
        </div>
      )}

      <section className="admin-toolbar">
        <div className="admin-filter-tabs">
          {statuses.map((status) => (
            <a key={status} className={selectedStatus === status ? "active" : ""} href={`/admin/inquiries?status=${status}${query ? `&q=${encodeURIComponent(query)}` : ""}`}>{status.replace("_", " ")}</a>
          ))}
        </div>
        <form className="admin-search-form">
          <input type="hidden" name="status" value={selectedStatus} />
          <AdminIcon name="search" />
          <input name="q" defaultValue={params.q} placeholder="Search name, company, or email" />
        </form>
      </section>

      {(inquiriesResult.error || linksResult.error) && <div className="admin-setup-banner"><strong>Inquiry automation setup required</strong><span>Run migration 202610060005 in Supabase to enable automatic client creation.</span></div>}

      <section className="admin-inquiry-list">
        {inquiries.map((inquiry) => (
          <details className="admin-inquiry-card" key={inquiry.id}>
            <summary>
              <span className="admin-inquiry-avatar">{inquiry.business_name.slice(0, 2).toUpperCase()}</span>
              <span className="admin-inquiry-identity"><strong>{inquiry.business_name}</strong><small>{inquiry.name} · {inquiry.email}</small></span>
              <StatusPill status={inquiry.status} />
              <span className="admin-inquiry-date">{formatDate(inquiry.created_at)}</span>
              <span className="admin-details-arrow"><AdminIcon name="arrow" /></span>
            </summary>
            <div className="admin-inquiry-body">
              <div className="admin-inquiry-message">
                <p className="admin-eyebrow">What is slowing them down</p>
                <blockquote>{inquiry.message}</blockquote>
                <div className="admin-inquiry-contact">
                  <a href={`mailto:${inquiry.email}`}><AdminIcon name="mail" /> {inquiry.email}</a>
                  {inquiry.phone && <a href={`tel:${inquiry.phone}`}>{inquiry.phone}</a>}
                  <span>Source: {inquiry.source}</span>
                  <span>Confirmation: <StatusPill status={inquiry.confirmation_status} /></span>
                  {linkedInquiryIds.has(inquiry.id) && <span className="admin-client-linked">✓ Client added</span>}
                </div>
              </div>
              <form className="admin-inquiry-update" action={updateInquiryAction}>
                <input type="hidden" name="id" value={inquiry.id} />
                <label>Status<select name="status" defaultValue={inquiry.status}>{statuses.filter((status) => status !== "all").map((status) => <option key={status} value={status}>{status.replace("_", " ")}</option>)}</select></label>
                <label>Internal notes<textarea name="notes" defaultValue={inquiry.admin_notes || ""} placeholder="Add context for the next follow-up…" rows={4} /></label>
                <SubmitButton>Save update</SubmitButton>
              </form>
            </div>
          </details>
        ))}
        {!inquiries.length && (
          <div className="admin-empty-state"><span><AdminIcon name="inquiries" size={26} /></span><h2>No inquiries found</h2><p>Try another filter, or wait for the next consultation request.</p></div>
        )}
      </section>
    </div>
  );
}
