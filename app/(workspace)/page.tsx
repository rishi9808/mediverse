import Link from "next/link";

import { requireClinician } from "@/lib/clinician";
import { getIndiaTimeGreeting } from "@/lib/greeting";
import { getSessionWorkflowCopy } from "@/lib/session-workflow";

import { createRecordingSession } from "./actions";
import { CalendarIcon, PlusIcon } from "./icons";

type TimelineRow = { session_id: string; patient_id: string; occurred_at: string; documentation_status: string };
type FollowUpRow = { id: string; patient_id: string; action: string; due_on: string; completed_at: string | null };

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat("en", { day: "numeric", month: "short" }).format(new Date(`${value}T00:00:00`));
}

function formatSessionDate(value: string) {
  return new Intl.DateTimeFormat("en", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function waitLabel(value: string) {
  const hours = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 3_600_000));
  if (hours < 1) return "Added recently";
  if (hours < 24) return `${hours}h waiting`;
  return `${Math.floor(hours / 24)}d waiting`;
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ onboarded?: string }> }) {
  const { onboarded } = await searchParams;
  const { supabase, clinician } = await requireClinician();
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const monthEnd = new Date(monthStart);
  monthEnd.setMonth(monthEnd.getMonth() + 1);
  const monthEndDate = new Date(monthEnd.getTime() - 86_400_000).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);

  const [patientsResult, timelineResult, followUpsResult] = await Promise.all([
    supabase.from("patients").select("id, display_code, display_name, created_at")
      .eq("clinician_id", clinician.id).is("archived_at", null).neq("display_code", "DEMO-001").order("created_at", { ascending: false }),
    supabase.from("patient_timeline").select("session_id, patient_id, occurred_at, documentation_status")
      .eq("clinician_id", clinician.id).order("occurred_at", { ascending: false }),
    supabase.from("follow_ups").select("id, patient_id, action, due_on, completed_at")
      .eq("clinician_id", clinician.id).is("completed_at", null).lte("due_on", monthEndDate).order("due_on"),
  ]);

  if (patientsResult.error || timelineResult.error || followUpsResult.error) throw new Error("We could not load the dashboard.");

  const patients = patientsResult.data ?? [];
  const patientIds = new Set(patients.map((patient) => patient.id));
  const patientById = new Map(patients.map((patient) => [patient.id, patient]));
  const timeline = (timelineResult.data ?? []).filter((row) => row.patient_id && patientIds.has(row.patient_id)) as TimelineRow[];
  const followUps = (followUpsResult.data ?? []) as FollowUpRow[];
  const sessionsThisMonth = timeline.filter((row) => new Date(row.occurred_at) >= monthStart && new Date(row.occurred_at) < monthEnd);
  const reviewQueue = timeline.filter((row) => ["ready_for_review", "draft_ready"].includes(row.documentation_status));
  const processingQueue = timeline.filter((row) => ["audio_ready", "transcribed"].includes(row.documentation_status));
  const dueFollowUps = followUps.filter((item) => item.due_on >= monthStart.toISOString().slice(0, 10));
  const workItems = [
    ...followUps.filter((item) => item.due_on < today).map((item) => ({ id: `follow-${item.id}`, href: `/patients/${item.patient_id}`, patientId: item.patient_id, title: item.action, detail: `Overdue since ${formatShortDate(item.due_on)}`, action: "Review follow-up", tone: "overdue" })),
    ...reviewQueue.map((item) => ({ id: item.session_id, href: `/sessions/${item.session_id}`, patientId: item.patient_id, title: getSessionWorkflowCopy(item.documentation_status).label, detail: `${formatSessionDate(item.occurred_at)} / ${waitLabel(item.occurred_at)}`, action: item.documentation_status === "draft_ready" ? "Review note" : "Review transcript", tone: "review" })),
    ...followUps.filter((item) => item.due_on === today).map((item) => ({ id: `follow-${item.id}`, href: `/patients/${item.patient_id}`, patientId: item.patient_id, title: item.action, detail: "Due today", action: "Review follow-up", tone: "today" })),
    ...processingQueue.map((item) => ({ id: item.session_id, href: `/sessions/${item.session_id}`, patientId: item.patient_id, title: getSessionWorkflowCopy(item.documentation_status).label, detail: `${formatSessionDate(item.occurred_at)} / Processing in the background`, action: "View progress", tone: "processing" })),
    ...followUps.filter((item) => item.due_on > today).map((item) => ({ id: `follow-${item.id}`, href: `/patients/${item.patient_id}`, patientId: item.patient_id, title: item.action, detail: `Due ${formatShortDate(item.due_on)}`, action: "View patient", tone: "upcoming" })),
  ];
  const newPatient = onboarded ? patientById.get(onboarded) : null;
  const greeting = getIndiaTimeGreeting();

  return (
    <main className="workspace-page dashboard-page">
      <header className="dashboard-heading">
        <div><p className="page-context">Psychologist workspace</p><h1>Good {greeting}, {clinician.display_name}</h1><p>Here is what needs your attention today.</p></div>
        <div className="dashboard-actions">
          <Link className="secondary-button" href="/patients/new"><PlusIcon /> Onboard patient</Link>
          <form action={createRecordingSession} className="start-session-form">
            <label className="sr-only" htmlFor="dashboard-patient">Patient</label>
            <select id="dashboard-patient" name="patientId" required defaultValue=""><option disabled value="">Choose a patient</option>{patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.display_name} ({patient.display_code})</option>)}</select>
            <input name="clientRequestId" type="hidden" value={crypto.randomUUID()} />
            <button className="primary-button" disabled={!patients.length} type="submit">Start session</button>
          </form>
        </div>
      </header>

      {newPatient && <section className="success-banner" aria-live="polite"><div><strong>{newPatient.display_name} was onboarded.</strong><span>The patient is ready for session documentation.</span></div><div><Link href={`/patients/${newPatient.id}`}>View patient</Link><form action={createRecordingSession}><input name="patientId" type="hidden" value={newPatient.id} /><input name="clientRequestId" type="hidden" value={crypto.randomUUID()} /><button type="submit">Start session</button></form></div></section>}

      <section className="metric-strip" aria-label="This month at a glance">
        <article><span>Active patients</span><strong>{patients.length}</strong><small>Current records</small></article>
        <article><span>Sessions this month</span><strong>{sessionsThisMonth.length}</strong><small>{monthStart.toLocaleString("en", { month: "long" })}</small></article>
        <article><span>Notes awaiting review</span><strong>{reviewQueue.length}</strong><small>Clinician action needed</small></article>
        <article><span>Follow-ups due</span><strong>{dueFollowUps.length}</strong><small>This month</small></article>
      </section>

      <div className="dashboard-grid">
        <section className="work-queue" aria-labelledby="work-queue-heading">
          <div className="section-heading-row"><div><h2 id="work-queue-heading">Work queue</h2><p>Ordered by clinical attention needed.</p></div><span>{workItems.length} open</span></div>
          {workItems.length ? <div className="queue-list">{workItems.slice(0, 8).map((item) => {
            const patient = patientById.get(item.patientId);
            if (!patient) return null;
            return <Link className="queue-row" href={item.href} key={item.id}><span className={`queue-marker ${item.tone}`} aria-hidden="true" /><div className="queue-patient"><strong>{patient.display_name}</strong><span>{patient.display_code}</span></div><div className="queue-task"><strong>{item.title}</strong><span>{item.detail}</span></div><span className="queue-action">{item.action}</span></Link>;
          })}</div> : <div className="queue-empty"><strong>Your queue is clear.</strong><p>New sessions and confirmed follow-ups will appear here.</p></div>}
        </section>

        <aside className="dashboard-side">
          <section aria-labelledby="recent-patients-heading"><div className="section-heading-row"><div><h2 id="recent-patients-heading">Recent patients</h2><p>Most recently added records.</p></div><Link href="/patients">View all</Link></div><div className="recent-patient-list">{patients.slice(0, 5).map((patient) => <Link href={`/patients/${patient.id}`} key={patient.id}><span className="patient-monogram" aria-hidden="true">{patient.display_name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span><span><strong>{patient.display_name}</strong><small>{patient.display_code}</small></span></Link>)}{!patients.length && <p className="muted-copy">No patients onboarded yet.</p>}</div></section>
          <section className="month-summary" aria-labelledby="month-summary-heading"><CalendarIcon /><div><h2 id="month-summary-heading">Monthly summary</h2><p>{sessionsThisMonth.filter((row) => row.documentation_status === "approved").length} approved notes from {sessionsThisMonth.length} sessions.</p></div></section>
        </aside>
      </div>
    </main>
  );
}
