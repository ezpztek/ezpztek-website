export default function AdminLoading() {
  return (
    <div className="admin-page admin-loading-page" aria-label="Loading workspace">
      <div className="admin-loading-line wide" />
      <div className="admin-loading-line short" />
      <div className="admin-loading-grid">
        {[0, 1, 2, 3].map((item) => <div className="admin-loading-card" key={item} />)}
      </div>
      <div className="admin-loading-panel" />
    </div>
  );
}

