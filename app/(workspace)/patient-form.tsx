"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import type { PatientFormState } from "./actions";

type PatientFormProps = {
  action: (state: PatientFormState, formData: FormData) => Promise<PatientFormState>;
  cancelHref: string;
  initialCode?: string;
  initialDateOfBirth?: string;
  initialEmail?: string;
  initialGender?: string;
  initialLocation?: string;
  initialMobile?: string;
  initialName?: string;
  mode: "create" | "edit";
};

const initialState: PatientFormState = { message: "" };

function SaveButton({ mode }: { mode: PatientFormProps["mode"] }) {
  const { pending } = useFormStatus();
  return (
    <button className="primary-button form-submit" type="submit" disabled={pending}>
      {pending ? "Saving…" : mode === "create" ? "Create patient" : "Save changes"}
    </button>
  );
}

export function PatientForm({
  action,
  cancelHref,
  initialCode = "",
  initialDateOfBirth = "",
  initialEmail = "",
  initialGender = "",
  initialLocation = "",
  initialMobile = "",
  initialName = "",
  mode,
}: PatientFormProps) {
  const [state, formAction] = useActionState(action, initialState);

  return (
    <form action={formAction} className="patient-form" noValidate>
      <div className="form-section-heading">
        <span>Identity and contact</span>
        <h2>Patient information</h2>
        <p>Required details used to identify and contact this patient.</p>
      </div>

      <div className="field-group">
        <label htmlFor="displayName">Display name</label>
        <input
          id="displayName"
          name="displayName"
          type="text"
          defaultValue={state.values?.displayName ?? initialName}
          aria-describedby="displayName-help displayName-error"
          aria-invalid={Boolean(state.errors?.displayName)}
          autoComplete="off"
          maxLength={120}
          required
          autoFocus
        />
        <p className="field-help" id="displayName-help">Use the patient’s full name.</p>
        {state.errors?.displayName && <p className="field-error" id="displayName-error">{state.errors.displayName}</p>}
      </div>

      <div className="field-group">
        <label htmlFor="mobile">Mobile number</label>
        <input
          id="mobile"
          name="mobile"
          type="tel"
          defaultValue={state.values?.mobile ?? initialMobile}
          aria-describedby="mobile-help mobile-error"
          aria-invalid={Boolean(state.errors?.mobile)}
          autoComplete="tel"
          inputMode="tel"
          maxLength={20}
          required
        />
        <p className="field-help" id="mobile-help">Include the country code, for example +919876543210.</p>
        {state.errors?.mobile && <p className="field-error" id="mobile-error">{state.errors.mobile}</p>}
      </div>

      <div className="field-group">
        <label htmlFor="email">Email address <span className="optional-label">Optional</span></label>
        <input
          id="email"
          name="email"
          type="email"
          defaultValue={state.values?.email ?? initialEmail}
          aria-describedby="email-help email-error"
          aria-invalid={Boolean(state.errors?.email)}
          autoComplete="email"
          maxLength={254}
        />
        <p className="field-help" id="email-help">Used only when the clinic needs to contact the patient.</p>
        {state.errors?.email && <p className="field-error" id="email-error">{state.errors.email}</p>}
      </div>

      <div className="field-group">
        <label htmlFor="location">Location</label>
        <input
          id="location"
          name="location"
          type="text"
          defaultValue={state.values?.location ?? initialLocation}
          aria-describedby="location-help location-error"
          aria-invalid={Boolean(state.errors?.location)}
          autoComplete="address-level2"
          maxLength={160}
          required
        />
        <p className="field-help" id="location-help">City, district, or locality.</p>
        {state.errors?.location && <p className="field-error" id="location-error">{state.errors.location}</p>}
      </div>

      <div className="form-section-heading secondary-form-section">
        <span>Optional demographics</span>
        <h2>Additional details</h2>
        <p>Add only information the clinic needs for the patient record.</p>
      </div>

      <div className="form-field-grid">
        <div className="field-group">
          <label htmlFor="dateOfBirth">Date of birth <span className="optional-label">Optional</span></label>
          <input
            id="dateOfBirth"
            name="dateOfBirth"
            type="date"
            defaultValue={state.values?.dateOfBirth ?? initialDateOfBirth}
            aria-describedby="dateOfBirth-error"
            aria-invalid={Boolean(state.errors?.dateOfBirth)}
            autoComplete="bday"
            min="1900-01-01"
            max={new Date().toISOString().slice(0, 10)}
          />
          {state.errors?.dateOfBirth && <p className="field-error" id="dateOfBirth-error">{state.errors.dateOfBirth}</p>}
        </div>

        <div className="field-group">
          <label htmlFor="gender">Gender <span className="optional-label">Optional</span></label>
          <input
            id="gender"
            name="gender"
            type="text"
            defaultValue={state.values?.gender ?? initialGender}
            aria-describedby="gender-error"
            aria-invalid={Boolean(state.errors?.gender)}
            autoComplete="sex"
            maxLength={60}
          />
          {state.errors?.gender && <p className="field-error" id="gender-error">{state.errors.gender}</p>}
        </div>
      </div>

      <div className="field-group">
        <label htmlFor="displayCode">Patient ID <span className="optional-label">Optional</span></label>
        <input
          id="displayCode"
          name="displayCode"
          type="text"
          defaultValue={state.values?.displayCode ?? initialCode}
          aria-describedby="displayCode-help displayCode-error"
          aria-invalid={Boolean(state.errors?.displayCode)}
          autoComplete="off"
          maxLength={40}
        />
        <p className="field-help" id="displayCode-help">Leave blank to generate a patient ID automatically.</p>
        {state.errors?.displayCode && <p className="field-error" id="displayCode-error">{state.errors.displayCode}</p>}
      </div>

      {state.message && <div className="form-alert" role="alert">{state.message}</div>}

      <div className="form-actions">
        <SaveButton mode={mode} />
        <Link className="secondary-button" href={cancelHref}>Cancel</Link>
      </div>
    </form>
  );
}
