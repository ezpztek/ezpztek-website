const labelMap: Record<string, string> = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  closed: "Closed",
  spam: "Spam",
  lead: "Lead",
  onboarding: "Onboarding",
  active: "Active",
  paused: "Paused",
  cancelled: "Cancelled",
  trial: "Trial",
  past_due: "Past due",
  expired: "Expired",
  sent: "Sent",
  failed: "Failed",
  pending: "Pending",
};

export function StatusPill({ status }: { status: string }) {
  return (
    <span className={`admin-status admin-status-${status}`}>
      <span aria-hidden="true" />
      {labelMap[status] || status}
    </span>
  );
}

