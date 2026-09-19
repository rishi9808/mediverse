"use client";

export default function WorkspaceError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="workspace-page">
      <section className="state-panel error-state" role="alert">
        <span className="state-symbol" aria-hidden="true">!</span>
        <div>
          <p className="section-kicker">Clinician workspace</p>
          <h1>Something interrupted the workspace</h1>
          <p>No patient information was changed. Try loading this screen again.</p>
          <button className="secondary-button" type="button" onClick={reset}>Try again</button>
        </div>
      </section>
    </main>
  );
}
