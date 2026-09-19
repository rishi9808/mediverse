import Link from "next/link";

import { createPatient } from "../../actions";
import { PatientForm } from "../../patient-form";

export default function NewPatientPage() {
  return (
    <main className="workspace-page narrow-page">
      <header className="page-heading compact-heading">
        <div>
          <Link className="back-link" href="/">← Back to patients</Link>
          <p className="page-context">Patient onboarding</p>
          <h1>New patient</h1>
          <p>Add the patient’s contact and demographic information.</p>
        </div>
      </header>
      <PatientForm action={createPatient} cancelHref="/" mode="create" />
    </main>
  );
}
