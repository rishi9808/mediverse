"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { login, loginAsReviewer, type LoginState } from "./actions";

const initialState: LoginState = { message: "" };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className="login-button" type="submit" disabled={pending}>
      <span>{pending ? "Signing in…" : "Sign in"}</span>
      {!pending && <span aria-hidden="true">→</span>}
    </button>
  );
}

function ReviewerSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className="reviewer-login-button" type="submit" disabled={pending}>
      {pending ? "Opening demo…" : "Skip login — enter reviewer demo"}
    </button>
  );
}

export function LoginForm() {
  const [state, formAction] = useActionState(login, initialState);
  const [reviewerState, reviewerFormAction] = useActionState(loginAsReviewer, initialState);

  return (
    <div className="login-options">
      <form action={reviewerFormAction} className="reviewer-login-form">
        <p>Hackathon reviewer? Open the fictional clinician workspace in one click.</p>
        <ReviewerSubmitButton />
        <div className="form-message reviewer-message" aria-live="polite">
          {reviewerState.message && <p>{reviewerState.message}</p>}
        </div>
      </form>

      <div className="login-divider"><span>or sign in manually</span></div>

      <form action={formAction} className="login-form">
        <div className="field-group">
          <label htmlFor="email">Email address</label>
          <input
            id="email"
            name="email"
            type="email"
            placeholder="you@practice.com"
            autoComplete="email"
            required
            autoFocus
          />
        </div>
        <div className="field-group">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            placeholder="Enter your password"
            autoComplete="current-password"
            required
          />
        </div>
        <div className="form-message" aria-live="polite">
          {state.message && <p>{state.message}</p>}
        </div>
        <SubmitButton />
      </form>
    </div>
  );
}
