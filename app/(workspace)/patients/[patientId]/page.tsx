import Link from "next/link";
import { notFound } from "next/navigation";

import { requireClinician } from "@/lib/clinician";
import { getSessionWorkflowCopy } from "@/lib/session-workflow";

import { createRecordingSession } from "../../actions";
import { CreateSessionButton, RetryButton } from "../../components";
import { CalendarIcon, EditIcon } from "../../icons";

type TimelineRow = {
  session_id: string;
  occurred_at: string;
  audio_source: string;
  documentation_status: string;
  approved_at: string | null;
};

function formatSessionDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function SessionList({ emptyCopy, sessions }: { emptyCopy: string; sessions: TimelineRow[] }) {
  if (!sessions.length) return <div className="small-empty-state">{emptyCopy}</div>;

  return (
    <div className="session-list">
      {sessions.map((session) => {
        const copy = getSessionWorkflowCopy(session.documentation_status);
        return (
          <Link className="session-row" href={`/sessions/${session.session_id}`} key={session.session_id}>
            <div className="session-icon"><CalendarIcon /></div>
            <div className="session-copy">
              <div className="session-title-line">
                <h3>{formatSessionDate(session.occurred_at)}</h3>
                <span className={`status-chip ${session.documentation_status === "approved" ? "" : "active-status"}`}>{copy.label}</span>
              </div>
              <p>{copy.detail}</p>
              <span>
                {session.audio_source === "upload"
                  ? "Uploaded session audio"
                  : session.audio_source === "recording"
                    ? "Recorded session audio"
                    : "Audio source not selected"}
              </span>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

export default async function PatientDetailPage({ params }: { params: Promise<{ patientId: string }> }) {
  const { patientId } = await params;
  const { supabase, clinician } = await requireClinician();
  const [{ data: patient, error: patientError }, { data: sessions, error: sessionsError }] =
    await Promise.all([
      supabase
        .from("patients")
        .select("id, display_code, display_name, mobile, email, location, date_of_birth, gender, created_at")
        .eq("id", patientId)
        .eq("clinician_id", clinician.id)
        .is("archived_at", null)
        .maybeSingle(),
      supabase
        .from("patient_timeline")
        .select("session_id, occurred_at, audio_source, documentation_status, approved_at")
        .eq("patient_id", patientId)
        .eq("clinician_id", clinician.id)
        .order("occurred_at", { ascending: false }),
    ]);

  if (patientError || sessionsError) {
    return (
      <main className="workspace-page">
        <section className="state-panel error-state" role="alert">
          <span className="state-symbol" aria-hidden="true">!</span>
          <div>
            <h1>We couldn’t load this patient</h1>
            <p>Your data has not changed. Check your connection and try again.</p>
            <RetryButton />
          </div>
        </section>
      </main>
    );
  }

  if (!patient) notFound();

  const typedSessions = (sessions ?? []) as TimelineRow[];
  const activeSessions = typedSessions.filter((session) => session.documentation_status !== "approved");
  const previousSessions = typedSessions.filter((session) => session.documentation_status === "approved");

  return (
    <main className="workspace-page">
      <Link className="back-link" href="/">← Back to patients</Link>
      <header className="patient-detail-heading">
        <div className="detail-monogram" aria-hidden="true">
          {patient.display_name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase()}
        </div>
        <div className="detail-title">
          <div className="patient-name-line">
            <h1>{patient.display_name}</h1>
          </div>
          <p>{patient.display_code} · Visible only to you</p>
        </div>
        <div className="patient-heading-actions">
          <form action={createRecordingSession}>
            <input name="patientId" type="hidden" value={patient.id} />
            <input name="clientRequestId" type="hidden" value={crypto.randomUUID()} />
            <CreateSessionButton />
          </form>
          <Link className="secondary-button edit-button" href={`/patients/${patient.id}/edit`}>
            <EditIcon /> Edit patient
          </Link>
        </div>
      </header>

      <section className="patient-contact-card" aria-labelledby="contact-details-heading">
        <div>
          <p className="section-kicker">Patient profile</p>
          <h2 id="contact-details-heading">Contact and demographics</h2>
        </div>
        <dl className="patient-contact-grid">
          <div><dt>Mobile</dt><dd>{patient.mobile}</dd></div>
          <div><dt>Email</dt><dd>{patient.email || "Not provided"}</dd></div>
          <div><dt>Location</dt><dd>{patient.location}</dd></div>
          <div><dt>Date of birth</dt><dd>{patient.date_of_birth ? new Intl.DateTimeFormat("en", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${patient.date_of_birth}T00:00:00Z`)) : "Not provided"}</dd></div>
          <div><dt>Gender</dt><dd>{patient.gender || "Not provided"}</dd></div>
        </dl>
      </section>

      <div className="timeline-sections">
        <section aria-labelledby="active-sessions-heading">
          <div className="list-heading">
            <div>
              <p className="section-kicker">Current work</p>
              <h2 id="active-sessions-heading">Active sessions</h2>
            </div>
            <span className="count-badge">{activeSessions.length}</span>
          </div>
          <SessionList emptyCopy="There are no active sessions for this patient." sessions={activeSessions} />
        </section>

        <section aria-labelledby="previous-sessions-heading">
          <div className="list-heading">
            <div>
              <p className="section-kicker">Clinical history</p>
              <h2 id="previous-sessions-heading">Previous sessions</h2>
            </div>
            <span className="count-badge">{previousSessions.length}</span>
          </div>
          <SessionList emptyCopy="No previous sessions have been approved yet." sessions={previousSessions} />
        </section>
      </div>
    </main>
  );
}
