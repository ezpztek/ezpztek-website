export default function PortalLoading() {
  return (
    <div className="client-loading-page" role="status" aria-live="polite" aria-label="Loading workspace">
      <span className="client-loading-label">Loading workspace…</span>
      <div className="client-loading-line wide" />
      <div className="client-loading-line short" />
      <div className="client-loading-grid">
        {[0, 1, 2, 3].map((item) => <div className="client-loading-card" key={item} />)}
      </div>
      <div className="client-loading-panel" />
    </div>
  );
}
