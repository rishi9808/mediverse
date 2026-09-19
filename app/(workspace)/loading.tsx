export default function WorkspaceLoading() {
  return (
    <main className="workspace-page" aria-busy="true" aria-label="Loading patient workspace">
      <div className="skeleton skeleton-kicker" />
      <div className="skeleton skeleton-title" />
      <div className="skeleton skeleton-copy" />
      <div className="skeleton-list">
        {[0, 1, 2].map((item) => (
          <div className="skeleton skeleton-row" key={item} />
        ))}
      </div>
      <span className="sr-only">Loading patient data…</span>
    </main>
  );
}
