export default function ClientSettingsLoading() {
  return (
    <div
      className="client-loading-page"
      role="status"
      aria-live="polite"
      aria-label="Loading client settings"
    >
      <span className="client-loading-label">Loading client settings...</span>
      <div className="client-loading-line wide" />
      <div className="client-loading-line short" />
      <div className="client-loading-grid">
        <div className="client-loading-card" />
        <div className="client-loading-card" />
      </div>
      <div className="client-loading-panel" />
    </div>
  );
}
