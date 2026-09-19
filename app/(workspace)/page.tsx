import Link from "next/link";

import { requireClinician } from "@/lib/clinician";

import { ArrowIcon, CalendarIcon, PlusIcon } from "./icons";
import { RetryButton } from "./components";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

export default async function PatientsPage() {
  const { supabase, clinician } = await requireClinician();
  const [{ data: patients, error: patientsError }, { data: timeline, error: timelineError }] =
    await Promise.all([
      supabase
        .from("patients")
        .select("id, display_code, display_name, mobile, location, created_at")
        .eq("clinician_id", clinician.id)
        .is("archived_at", null)
        .order("created_at", { ascending: false }),
      supabase
        .from("patient_timeline")
        .select("patient_id, occurred_at, documentation_status")
        .eq("clinician_id", clinician.id)
        .order("occurred_at", { ascending: false }),
    ]);

  if (patientsError || timelineError) {
    return (
      <main className="workspace-page">
        <PageHeading />
        <section className="state-panel error-state" role="alert">
          <span className="state-symbol" aria-hidden="true">!</span>
          <div>
            <h2>We couldn’t load your patients</h2>
            <p>Your data has not changed. Check your connection and try again.</p>
            <RetryButton />
          </div>
        </section>
      </main>
    );
  }

  const sessionsByPatient = new Map<string, NonNullable<typeof timeline>>();
  for (const session of timeline ?? []) {
    if (!session.patient_id) continue;
    const sessions = sessionsByPatient.get(session.patient_id) ?? [];
    sessions.push(session);
    sessionsByPatient.set(session.patient_id, sessions);
  }

  return (
    <main className="workspace-page">
      <PageHeading />

      {!patients?.length ? (
        <section className="state-panel empty-patients">
          <div className="empty-illustration" aria-hidden="true">
            <span>FP</span>
            <span>+</span>
          </div>
          <div>
            <p className="section-kicker">Your patient list is empty</p>
            <h2>Onboard your first patient</h2>
            <p>Add the patient’s contact details to begin their clinical record.</p>
            <Link className="primary-button" href="/patients/new">
              <PlusIcon /> Create patient
            </Link>
          </div>
        </section>
      ) : (
        <section aria-labelledby="patient-list-heading">
          <div className="list-heading">
            <div>
              <p className="section-kicker">Patient directory</p>
              <h2 id="patient-list-heading">{patients.length} {patients.length === 1 ? "patient" : "patients"}</h2>
            </div>
            <span className="ownership-note">Visible only to you</span>
          </div>
          <div className="patient-list">
            {patients.map((patient) => {
              const sessions = sessionsByPatient.get(patient.id) ?? [];
              const activeCount = sessions.filter((session) => session.documentation_status !== "approved").length;
              return (
                <Link className="patient-row" href={`/patients/${patient.id}`} key={patient.id}>
                  <div className="patient-monogram" aria-hidden="true">
                    {patient.display_name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase()}
                  </div>
                  <div className="patient-identity">
                    <div className="patient-name-line">
                      <h3>{patient.display_name}</h3>
                    </div>
                    <p>{patient.display_code} · {patient.mobile}</p>
                  </div>
                  <div className="patient-meta">
                    <CalendarIcon />
                    <span>{patient.location} · {sessions[0]?.occurred_at ? `Last session ${formatDate(sessions[0].occurred_at)}` : "No sessions yet"}</span>
                  </div>
                  <div className="patient-status">
                    {activeCount > 0 ? <span className="status-chip active-status">{activeCount} active</span> : <span className="status-chip">Up to date</span>}
                    <ArrowIcon />
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </main>
  );
}

function PageHeading() {
  return (
    <header className="page-heading">
      <div>
        <p className="page-context">Clinician workspace</p>
        <h1>Patients</h1>
        <p>Manage patient profiles and review their session history.</p>
      </div>
      <Link className="primary-button" href="/patients/new">
        <PlusIcon /> New patient
      </Link>
    </header>
  );
}
