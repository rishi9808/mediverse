import Link from "next/link";
import { notFound } from "next/navigation";

import { requireClinician } from "@/lib/clinician";

import { updatePatient } from "../../../actions";
import { PatientForm } from "../../../patient-form";
import { RetryButton } from "../../../components";

export default async function EditPatientPage({ params }: { params: Promise<{ patientId: string }> }) {
  const { patientId } = await params;
  const { supabase, clinician } = await requireClinician();
  const { data: patient, error } = await supabase
    .from("patients")
    .select("id, display_code, display_name, mobile, email, location, date_of_birth, gender")
    .eq("id", patientId)
    .eq("clinician_id", clinician.id)
    .is("archived_at", null)
    .maybeSingle();

  if (error) {
    return (
      <main className="workspace-page narrow-page">
        <section className="state-panel error-state" role="alert">
          <span className="state-symbol" aria-hidden="true">!</span>
          <div>
            <h1>We couldn’t load this patient</h1>
            <p>Check your connection and try again.</p>
            <RetryButton />
          </div>
        </section>
      </main>
    );
  }

  if (!patient) notFound();
  const updatePatientWithId = updatePatient.bind(null, patient.id);

  return (
    <main className="workspace-page narrow-page">
      <header className="page-heading compact-heading">
        <div>
          <Link className="back-link" href={`/patients/${patient.id}`}>← Back to patient</Link>
          <p className="page-context">Patient profile</p>
          <h1>Edit patient</h1>
          <p>Update the patient’s contact or demographic details. Session history will remain unchanged.</p>
        </div>
      </header>
      <PatientForm
        action={updatePatientWithId}
        cancelHref={`/patients/${patient.id}`}
        initialCode={patient.display_code}
        initialDateOfBirth={patient.date_of_birth ?? ""}
        initialEmail={patient.email ?? ""}
        initialGender={patient.gender ?? ""}
        initialLocation={patient.location}
        initialMobile={patient.mobile}
        initialName={patient.display_name}
        mode="edit"
      />
    </main>
  );
}
