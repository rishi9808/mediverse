import Link from "next/link";

export default function PatientNotFound() {
  return (
    <main className="workspace-page">
      <section className="state-panel">
        <span className="state-symbol muted-symbol" aria-hidden="true">?</span>
        <div>
          <p className="section-kicker">Clinician workspace</p>
          <h1>Patient not found</h1>
          <p>This patient does not exist or is not available in your workspace.</p>
          <Link className="secondary-button" href="/">Return to patients</Link>
        </div>
      </section>
    </main>
  );
}
