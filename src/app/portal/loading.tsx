export default function PortalLoading() {
  return (
    <div className="client-loading-page" role="status" aria-live="polite">
      <div className="client-loading-status">
        <span className="client-loading-mark" aria-hidden="true"><i /></span>
        <span><strong>Loading your workspace</strong><small>Getting the latest business data…</small></span>
      </div>
      <span className="client-loading-label">Loading workspace…</span>
      <div className="client-loading-line wide" />
      <div className="client-loading-line short" />
      <div className="client-loading-grid">
        {[0, 1, 2, 3].map((item) => <div className="client-loading-card" key={item} />)}
      </div>
      <div className="client-loading-columns">
        <div className="client-loading-panel" />
        <div className="client-loading-panel compact" />
      </div>
    </div>
  );
}
