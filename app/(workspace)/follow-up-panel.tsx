"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  completeFollowUp,
  createFollowUp,
  rescheduleFollowUp,
  type FollowUpFormState,
} from "./actions";

type FollowUp = {
  id: string;
  action: string;
  privateNote: string | null;
  dueOn: string;
};

const initialState: FollowUpFormState = { message: "" };

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${value}T00:00:00`));
}

export function FollowUpPanel({
  followUps,
  patientId,
  sessionId,
}: {
  followUps: FollowUp[];
  patientId: string;
  sessionId?: string;
}) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [pending, startTransition] = useTransition();
  const [state, formAction, formPending] = useActionState(createFollowUp, initialState);
  const [message, setMessage] = useState("");
  const today = new Date().toISOString().slice(0, 10);

  function complete(id: string) {
    setMessage("");
    startTransition(async () => {
      const result = await completeFollowUp(id, patientId);
      setMessage(result.message);
      router.refresh();
    });
  }

  function reschedule(id: string, dueOn: string) {
    setMessage("");
    startTransition(async () => {
      const result = await rescheduleFollowUp(id, patientId, dueOn);
      setMessage(result.message);
      router.refresh();
    });
  }

  return (
    <section className="follow-up-panel" aria-labelledby="follow-up-heading">
      <div className="section-heading-row">
        <div><h2 id="follow-up-heading">Follow-ups</h2><p>Actions explicitly confirmed by the psychologist.</p></div>
        <button className="secondary-button" type="button" onClick={() => setShowForm((current) => !current)}>{showForm ? "Close" : "Add follow-up"}</button>
      </div>

      {showForm && (
        <form action={formAction} className="follow-up-form">
          <input name="patientId" type="hidden" value={patientId} />
          {sessionId && <input name="sessionId" type="hidden" value={sessionId} />}
          <div className="field-group"><label htmlFor={`follow-up-action-${sessionId ?? patientId}`}>Action</label><input id={`follow-up-action-${sessionId ?? patientId}`} maxLength={240} name="action" required /></div>
          <div className="field-group"><label htmlFor={`follow-up-date-${sessionId ?? patientId}`}>Due date</label><input id={`follow-up-date-${sessionId ?? patientId}`} min={today} name="dueOn" type="date" required /></div>
          <div className="field-group full-span"><label htmlFor={`follow-up-note-${sessionId ?? patientId}`}>Private note <span className="optional-label">Optional</span></label><textarea id={`follow-up-note-${sessionId ?? patientId}`} maxLength={2000} name="privateNote" rows={3} /></div>
          <div className="full-span follow-up-form-footer"><button className="primary-button" disabled={formPending} type="submit">{formPending ? "Adding…" : "Add to work queue"}</button>{state.message && <p className={state.ok ? "audio-message" : "audio-error"} role="status">{state.message}</p>}</div>
        </form>
      )}

      {followUps.length ? (
        <div className="follow-up-list">
          {followUps.map((followUp) => (
            <article key={followUp.id}>
              <div><strong>{followUp.action}</strong><span className={followUp.dueOn < today ? "overdue-text" : ""}>{followUp.dueOn < today ? "Overdue / " : "Due "}{formatDate(followUp.dueOn)}</span>{followUp.privateNote && <p>{followUp.privateNote}</p>}</div>
              <div className="follow-up-actions"><label><span className="sr-only">Reschedule {followUp.action}</span><input defaultValue={followUp.dueOn} min={today} type="date" onChange={(event) => reschedule(followUp.id, event.target.value)} /></label><button disabled={pending} type="button" onClick={() => complete(followUp.id)}>Complete</button></div>
            </article>
          ))}
        </div>
      ) : <p className="small-empty-state">No open follow-ups for this patient.</p>}
      {message && <p className="audio-message" role="status">{message}</p>}
    </section>
  );
}
