"use client";

import { useActionState } from "react";

import { submitEvaluationFeedback, type FeedbackFormState } from "../actions";

const initialState: FeedbackFormState = { message: "" };

function Rating({ help, label, name }: { help: string; label: string; name: string }) {
  return (
    <fieldset className="rating-field">
      <legend>{label}</legend>
      <p>{help}</p>
      <div>{[1, 2, 3, 4, 5].map((value) => <label key={value}><input name={name} required type="radio" value={value} /><span>{value}</span></label>)}</div>
      <small><span>Low</span><span>High</span></small>
    </fieldset>
  );
}

export function FeedbackForm() {
  const [state, formAction, pending] = useActionState(submitEvaluationFeedback, initialState);
  if (state.ok) return <div className="feedback-thanks" role="status"><strong>Thank you for the thoughtful review.</strong><p>Your feedback was saved and will be used to prioritize workflow improvements.</p></div>;

  return (
    <form action={formAction} className="feedback-form">
      <Rating help="How closely did the draft reflect the session?" label="Note accuracy" name="noteAccuracy" />
      <div className="field-group"><label htmlFor="missing-information">What important information was missing?</label><textarea id="missing-information" maxLength={2000} name="missingInformation" required rows={4} /></div>
      <Rating help="How much work was needed to make the note approvable?" label="Correction effort" name="correctionEffort" />
      <div className="field-group"><label htmlFor="approval-minutes">Minutes from opening the draft to approval</label><input id="approval-minutes" max={240} min={0} name="approvalMinutes" required type="number" /></div>
      <Rating help="How useful would this workflow be in routine practice?" label="Overall usefulness" name="usefulness" />
      <fieldset className="pilot-field"><legend>Would you consider a supervised pilot?</legend><div><label><input name="pilotInterest" required type="radio" value="yes" /> Yes</label><label><input name="pilotInterest" required type="radio" value="maybe" /> Maybe</label><label><input name="pilotInterest" required type="radio" value="no" /> No</label></div></fieldset>
      <div className="field-group"><label htmlFor="feedback-comments">Anything else we should improve? <span className="optional-label">Optional</span></label><textarea id="feedback-comments" maxLength={2000} name="comments" rows={4} /></div>
      {state.message && <p className="form-alert" role="alert">{state.message}</p>}
      <button className="primary-button" disabled={pending} type="submit">{pending ? "Saving feedback…" : "Submit feedback"}</button>
    </form>
  );
}
