"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { login, type LoginState } from "./actions";

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

export function LoginForm() {
  const [state, formAction] = useActionState(login, initialState);

  return (
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
  );
}
