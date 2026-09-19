"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";

import {
  MAX_AUDIO_BYTES,
  MAX_AUDIO_DURATION_MS,
  SUPPORTED_AUDIO_MIME_TYPES,
  type AudioSource,
  type SupportedAudioMimeType,
} from "@/lib/audio";
import { requireClinician } from "@/lib/clinician";
import {
  AUDIO_UPLOAD_CONSENT_POLICY_VERSION,
  RECORDING_CONSENT_POLICY_VERSION,
} from "@/lib/recording-consent";
import { processDraftingJob, processSpeakerIdentificationJob } from "@/lib/clinical-ai";
import type { SoapDocument } from "@/lib/soap";
import { processTranscriptionJob } from "@/lib/transcription";

export type PatientFormState = {
  message: string;
  errors?: {
    displayName?: string;
    displayCode?: string;
    mobile?: string;
    email?: string;
    location?: string;
    dateOfBirth?: string;
    gender?: string;
  };
  values?: {
    displayName: string;
    displayCode: string;
    mobile: string;
    email: string;
    location: string;
    dateOfBirth: string;
    gender: string;
  };
};

function readPatientForm(formData: FormData): PatientFormState & {
  values: NonNullable<PatientFormState["values"]>;
} {
  const rawName = formData.get("displayName");
  const rawCode = formData.get("displayCode");
  const rawMobile = formData.get("mobile");
  const rawEmail = formData.get("email");
  const rawLocation = formData.get("location");
  const rawDateOfBirth = formData.get("dateOfBirth");
  const rawGender = formData.get("gender");
  const displayName = typeof rawName === "string" ? rawName.trim() : "";
  const displayCode = typeof rawCode === "string" ? rawCode.trim().toUpperCase() : "";
  const mobile = typeof rawMobile === "string" ? rawMobile.replace(/[\s()-]/g, "") : "";
  const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
  const location = typeof rawLocation === "string" ? rawLocation.trim() : "";
  const dateOfBirth = typeof rawDateOfBirth === "string" ? rawDateOfBirth.trim() : "";
  const gender = typeof rawGender === "string" ? rawGender.trim() : "";
  const errors: NonNullable<PatientFormState["errors"]> = {};

  if (!displayName) errors.displayName = "Enter the patient’s full name.";
  else if (displayName.length > 120) errors.displayName = "Use 120 characters or fewer.";

  if (displayCode.length > 40) errors.displayCode = "Use 40 characters or fewer.";
  if (!/^\+[1-9]\d{7,14}$/.test(mobile)) {
    errors.mobile = "Enter a valid mobile number with country code, such as +919876543210.";
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = "Enter a valid email address or leave this field blank.";
  }
  if (!location) errors.location = "Enter the patient’s location.";
  else if (location.length > 160) errors.location = "Use 160 characters or fewer.";
  if (dateOfBirth) {
    const today = new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth) || dateOfBirth < "1900-01-01" || dateOfBirth > today) {
      errors.dateOfBirth = "Enter a valid date of birth.";
    }
  }
  if (gender.length > 60) errors.gender = "Use 60 characters or fewer.";

  return {
    message: Object.keys(errors).length ? "Review the highlighted fields." : "",
    errors,
    values: { displayName, displayCode, mobile, email, location, dateOfBirth, gender },
  };
}

function patientWriteError(code: string | undefined): PatientFormState["message"] {
  if (code === "23505") return "That patient reference code is already in use.";
  return "We couldn’t save this patient. Your entries are still here, so you can try again.";
}

export async function createPatient(
  _previousState: PatientFormState,
  formData: FormData,
): Promise<PatientFormState> {
  const input = readPatientForm(formData);
  if (Object.keys(input.errors ?? {}).length) return input;

  const { supabase, clinician } = await requireClinician();
  const { data, error } = await supabase
    .from("patients")
    .insert({
      clinician_id: clinician.id,
      display_name: input.values.displayName,
      display_code: input.values.displayCode || `PT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      mobile: input.values.mobile,
      email: input.values.email || null,
      location: input.values.location,
      date_of_birth: input.values.dateOfBirth || null,
      gender: input.values.gender || null,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { ...input, message: patientWriteError(error?.code) };
  }

  revalidatePath("/");
  revalidatePath("/patients");
  redirect(`/?onboarded=${data.id}`);
}

export async function updatePatient(
  patientId: string,
  _previousState: PatientFormState,
  formData: FormData,
): Promise<PatientFormState> {
  const input = readPatientForm(formData);
  if (Object.keys(input.errors ?? {}).length) return input;

  const { supabase, clinician } = await requireClinician();
  const { data, error } = await supabase
    .from("patients")
    .update({
      display_name: input.values.displayName,
      display_code: input.values.displayCode || `PT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      mobile: input.values.mobile,
      email: input.values.email || null,
      location: input.values.location,
      date_of_birth: input.values.dateOfBirth || null,
      gender: input.values.gender || null,
    })
    .eq("id", patientId)
    .eq("clinician_id", clinician.id)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    return { ...input, message: patientWriteError(error?.code) };
  }

  revalidatePath("/");
  revalidatePath(`/patients/${patientId}`);
  redirect(`/patients/${patientId}`);
}

export async function createRecordingSession(formData: FormData) {
  const patientId = formData.get("patientId");
  const clientRequestId = formData.get("clientRequestId");

  if (typeof patientId !== "string" || typeof clientRequestId !== "string") {
    throw new Error("The session request was incomplete. Please try again.");
  }

  const { supabase } = await requireClinician();
  const { data, error } = await supabase.rpc("create_recording_session", {
    p_patient_id: patientId,
    p_client_request_id: clientRequestId,
  });

  if (error || !data) {
    throw new Error("We couldn’t create this session. Please try again.");
  }

  revalidatePath(`/patients/${patientId}`);
  redirect(`/sessions/${data.id}`);
}

export type AudioAcknowledgmentResult =
  | { ok: true; recordedAt: string; source: AudioSource }
  | { ok: false; message: string };

export async function saveAudioAcknowledgment(
  sessionId: string,
  source: AudioSource,
): Promise<AudioAcknowledgmentResult> {
  const { supabase, clinician } = await requireClinician();
  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .select("id, audio_source")
    .eq("id", sessionId)
    .eq("clinician_id", clinician.id)
    .maybeSingle();

  if (
    sessionError ||
    !session ||
    !["pending", source].includes(session.audio_source)
  ) {
    return { ok: false, message: "This audio option is unavailable for the session." };
  }

  const { error: sourceError } = await supabase.rpc("select_audio_source", {
    p_session_id: session.id,
    p_audio_source: source,
  });
  if (sourceError) {
    return { ok: false, message: "We couldn’t select this audio option. Please try again." };
  }

  const policyVersion =
    source === "recording"
      ? RECORDING_CONSENT_POLICY_VERSION
      : AUDIO_UPLOAD_CONSENT_POLICY_VERSION;

  const { data: consentEventId, error: consentError } = await supabase.rpc(
    "record_consent",
    {
      p_session_id: session.id,
      p_decision: "granted",
      p_policy_version: policyVersion,
    },
  );

  if (consentError || !consentEventId) {
    return {
      ok: false,
      message: "We couldn’t save the acknowledgment. Recording has not started.",
    };
  }

  const { data: event, error: eventError } = await supabase
    .from("consent_events")
    .select("recorded_at")
    .eq("id", consentEventId)
    .eq("clinician_id", clinician.id)
    .single();

  if (eventError || !event) {
    return {
      ok: false,
      message: "We couldn’t verify the acknowledgment. Recording has not started.",
    };
  }

  revalidatePath(`/sessions/${session.id}`);
  return { ok: true, recordedAt: event.recorded_at, source };
}

export type PreparedAudioAsset = {
  id: string;
  bucketId: string;
  objectPath: string;
  state: string;
};

export type PrepareAudioResult =
  | { ok: true; asset: PreparedAudioAsset }
  | { ok: false; message: string };

export async function prepareAudioAsset(
  sessionId: string,
  mimeType: SupportedAudioMimeType,
  durationMs: number,
  byteSize: number,
): Promise<PrepareAudioResult> {
  if (
    !(SUPPORTED_AUDIO_MIME_TYPES as readonly string[]).includes(mimeType) ||
    !Number.isInteger(durationMs) ||
    durationMs < 1 ||
    durationMs > MAX_AUDIO_DURATION_MS ||
    !Number.isInteger(byteSize) ||
    byteSize < 1 ||
    byteSize > MAX_AUDIO_BYTES
  ) {
    return { ok: false, message: "The audio exceeds the supported format, duration, or size limits." };
  }

  const { supabase, clinician } = await requireClinician();
  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .select("id, audio_source")
    .eq("id", sessionId)
    .eq("clinician_id", clinician.id)
    .maybeSingle();
  if (sessionError || !session || !["recording", "upload"].includes(session.audio_source)) {
    return { ok: false, message: "This session is not ready for audio." };
  }

  const { data: asset, error } = await supabase.rpc("register_audio", {
    p_session_id: session.id,
    p_mime_type: mimeType,
  });
  if (error || !asset?.object_path) {
    return {
      ok: false,
      message: error?.code === "23514"
        ? "Retry with the same audio format selected for this session."
        : "We couldn’t prepare the private audio upload. Please try again.",
    };
  }

  return {
    ok: true,
    asset: {
      id: asset.id,
      bucketId: asset.bucket_id,
      objectPath: asset.object_path,
      state: asset.state,
    },
  };
}

export type FinalizeAudioResult = { ok: true } | { ok: false; message: string };

export async function finalizeAudioAsset(
  sessionId: string,
  assetId: string,
  durationMs: number,
  byteSize: number,
): Promise<FinalizeAudioResult> {
  const { supabase } = await requireClinician();
  const { data, error } = await supabase.rpc("finalize_audio_upload", {
    p_audio_asset_id: assetId,
    p_duration_ms: durationMs,
    p_expected_byte_size: byteSize,
  });
  if (error || !data) {
    return { ok: false, message: "The upload is incomplete. You can retry without recreating the session." };
  }

  const { data: job } = await supabase
    .from("processing_jobs")
    .select("id, status")
    .eq("session_id", sessionId)
    .eq("kind", "transcription")
    .eq("request_key", assetId)
    .maybeSingle();
  if (job?.status === "queued") {
    after(() => processTranscriptionJob(job.id, supabase));
  }

  revalidatePath(`/sessions/${sessionId}`);
  return { ok: true };
}

export type TranscriptionActionResult =
  | { ok: true }
  | { ok: false; message: string; conflict?: boolean };

export async function continueTranscription(sessionId: string, jobId: string) {
  const { supabase, clinician } = await requireClinician();
  const { data: job } = await supabase
    .from("processing_jobs")
    .select("id, status, attempts")
    .eq("id", jobId)
    .eq("session_id", sessionId)
    .eq("clinician_id", clinician.id)
    .eq("kind", "transcription")
    .maybeSingle();
  if (job && ["queued", "running"].includes(job.status) && job.attempts < 3) {
    after(() => processTranscriptionJob(job.id, supabase));
  }
}

export async function retryTranscription(
  sessionId: string,
  jobId: string,
): Promise<TranscriptionActionResult> {
  const { supabase } = await requireClinician();
  const { data: job, error } = await supabase.rpc("retry_transcription_job", {
    p_job_id: jobId,
  });
  if (error || !job || job.status !== "queued") {
    return { ok: false, message: "This transcription cannot be retried again." };
  }

  after(() => processTranscriptionJob(job.id, supabase));
  revalidatePath(`/sessions/${sessionId}`);
  return { ok: true };
}

export async function confirmTranscriptSpeakers(
  sessionId: string,
  transcriptId: string,
  assignments: Record<string, "clinician" | "patient">,
): Promise<TranscriptionActionResult> {
  const entries = Object.entries(assignments);
  if (
    entries.length === 0 ||
    entries.some(([speaker, role]) => !speaker.trim() || !["clinician", "patient"].includes(role))
  ) {
    return { ok: false, message: "Assign every speaker as Psychologist or Patient." };
  }

  const { supabase } = await requireClinician();
  const { error } = await supabase.rpc("confirm_transcript_speakers", {
    p_transcript_id: transcriptId,
    p_assignments: assignments,
  });
  if (error) {
    return { ok: false, message: "We couldn’t confirm the speakers. Review each assignment and try again." };
  }

  const { data: draftingJob } = await supabase
    .from("processing_jobs")
    .select("id")
    .eq("transcript_id", transcriptId)
    .eq("kind", "drafting")
    .eq("status", "queued")
    .maybeSingle();
  if (draftingJob) after(() => processDraftingJob(draftingJob.id, supabase));

  revalidatePath(`/sessions/${sessionId}`);
  return { ok: true };
}

export async function continueSpeakerIdentification(sessionId: string, jobId: string) {
  const { supabase, clinician } = await requireClinician();
  const { data: job } = await supabase
    .from("processing_jobs")
    .select("id, status, attempts")
    .eq("id", jobId)
    .eq("session_id", sessionId)
    .eq("clinician_id", clinician.id)
    .eq("kind", "speaker_identification")
    .maybeSingle();
  if (job && ["queued", "running"].includes(job.status) && job.attempts < 3) {
    after(() => processSpeakerIdentificationJob(job.id, supabase));
  }
}

export async function retrySpeakerIdentification(
  sessionId: string,
  jobId: string,
): Promise<TranscriptionActionResult> {
  const { supabase } = await requireClinician();
  const { data: job, error } = await supabase.rpc("retry_speaker_identification_job", {
    p_job_id: jobId,
  });
  if (error || !job || job.status !== "queued") {
    return { ok: false, message: "Speaker identification cannot be retried again." };
  }
  after(() => processSpeakerIdentificationJob(job.id, supabase));
  revalidatePath(`/sessions/${sessionId}`);
  return { ok: true };
}

export async function continueDrafting(sessionId: string, jobId: string) {
  const { supabase, clinician } = await requireClinician();
  const { data: job } = await supabase
    .from("processing_jobs")
    .select("id, status, attempts")
    .eq("id", jobId)
    .eq("session_id", sessionId)
    .eq("clinician_id", clinician.id)
    .eq("kind", "drafting")
    .maybeSingle();
  if (job && ["queued", "running"].includes(job.status) && job.attempts < 3) {
    after(() => processDraftingJob(job.id, supabase));
  }
}

export async function retryDrafting(
  sessionId: string,
  jobId: string,
): Promise<TranscriptionActionResult> {
  const { supabase } = await requireClinician();
  const { data: job, error } = await supabase.rpc("retry_drafting_job", { p_job_id: jobId });
  if (error || !job || job.status !== "queued") {
    return { ok: false, message: "This SOAP draft cannot be retried again." };
  }
  after(() => processDraftingJob(job.id, supabase));
  revalidatePath(`/sessions/${sessionId}`);
  return { ok: true };
}

export async function saveSoapDraft(
  sessionId: string,
  transcriptId: string,
  expectedVersion: number,
  content: SoapDocument,
): Promise<TranscriptionActionResult> {
  const { supabase } = await requireClinician();
  const { error } = await supabase.rpc("save_note_revision", {
    p_session_id: sessionId,
    p_transcript_id: transcriptId,
    p_expected_version: expectedVersion,
    p_content: content,
    p_prompt_version: "clinician-edit-v1",
  });
  if (error) {
    return {
      ok: false,
      conflict: error.code === "40001",
      message: error.code === "40001"
        ? "A newer revision exists. Your edits are still here and were not overwritten. Load the latest revision when you are ready to reconcile them."
        : "We couldn’t save this SOAP revision. Review the entries and evidence, then try again.",
    };
  }
  revalidatePath(`/sessions/${sessionId}`);
  return { ok: true };
}

export async function approveSoapNote(
  sessionId: string,
  noteRevisionId: string,
  confirmed: boolean,
): Promise<TranscriptionActionResult> {
  const { supabase } = await requireClinician();
  if (!confirmed) {
    return { ok: false, message: "Confirm that you reviewed the complete note before approval." };
  }

  const { error } = await supabase.rpc("approve_note", {
    p_session_id: sessionId,
    p_note_revision_id: noteRevisionId,
    p_confirmed: confirmed,
  });
  if (error) {
    return {
      ok: false,
      conflict: error.code === "40001",
      message: error.code === "40001"
        ? "A newer revision exists. Load the latest revision before approving."
        : "Approval failed. Confirm that every SOAP section is complete and the latest revision is saved.",
    };
  }

  revalidatePath(`/sessions/${sessionId}`);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function regenerateSoapDraft(
  sessionId: string,
  transcriptId: string,
  expectedVersion: number,
): Promise<TranscriptionActionResult> {
  const { supabase } = await requireClinician();
  const { data: job, error } = await supabase.rpc("enqueue_drafting_job", {
    p_session_id: sessionId,
    p_transcript_id: transcriptId,
    p_expected_version: expectedVersion,
  });
  if (error || !job) {
    return {
      ok: false,
      message: error?.code === "40001"
        ? "A newer draft exists. Refresh before regenerating."
        : "We couldn’t start regeneration. Another draft may already be processing.",
    };
  }
  after(() => processDraftingJob(job.id, supabase));
  revalidatePath(`/sessions/${sessionId}`);
  return { ok: true };
}

export type FollowUpFormState = { ok?: boolean; message: string };

export async function createFollowUp(
  _previousState: FollowUpFormState,
  formData: FormData,
): Promise<FollowUpFormState> {
  const patientId = formData.get("patientId");
  const sessionId = formData.get("sessionId");
  const rawAction = formData.get("action");
  const rawNote = formData.get("privateNote");
  const dueOn = formData.get("dueOn");
  const action = typeof rawAction === "string" ? rawAction.trim() : "";
  const privateNote = typeof rawNote === "string" ? rawNote.trim() : "";

  if (typeof patientId !== "string" || !patientId || !action || action.length > 240) {
    return { message: "Enter a follow-up action of 240 characters or fewer." };
  }
  if (typeof dueOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dueOn)) {
    return { message: "Choose a valid follow-up date." };
  }
  if (privateNote.length > 2000) return { message: "Use 2,000 characters or fewer for the private note." };

  const { supabase, clinician } = await requireClinician();
  const { error } = await supabase.from("follow_ups").insert({
    clinician_id: clinician.id,
    patient_id: patientId,
    session_id: typeof sessionId === "string" && sessionId ? sessionId : null,
    action,
    private_note: privateNote || null,
    due_on: dueOn,
  });
  if (error) return { message: "We couldn’t save this follow-up. Check the patient and date, then try again." };

  revalidatePath("/");
  revalidatePath(`/patients/${patientId}`);
  return { ok: true, message: "Follow-up added to the work queue." };
}

export async function completeFollowUp(followUpId: string, patientId: string) {
  const { supabase, clinician } = await requireClinician();
  const { error } = await supabase.from("follow_ups").update({ completed_at: new Date().toISOString() })
    .eq("id", followUpId).eq("patient_id", patientId).eq("clinician_id", clinician.id).is("completed_at", null);
  if (error) return { ok: false, message: "We couldn’t complete this follow-up." };
  revalidatePath("/");
  revalidatePath(`/patients/${patientId}`);
  return { ok: true, message: "Follow-up completed." };
}

export async function rescheduleFollowUp(followUpId: string, patientId: string, dueOn: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueOn)) return { ok: false, message: "Choose a valid date." };
  const { supabase, clinician } = await requireClinician();
  const { error } = await supabase.from("follow_ups").update({ due_on: dueOn })
    .eq("id", followUpId).eq("patient_id", patientId).eq("clinician_id", clinician.id).is("completed_at", null);
  if (error) return { ok: false, message: "We couldn’t reschedule this follow-up." };
  revalidatePath("/");
  revalidatePath(`/patients/${patientId}`);
  return { ok: true, message: "Follow-up rescheduled." };
}

export type FeedbackFormState = { ok?: boolean; message: string };

export async function submitEvaluationFeedback(
  _previousState: FeedbackFormState,
  formData: FormData,
): Promise<FeedbackFormState> {
  const number = (name: string) => Number(formData.get(name));
  const noteAccuracy = number("noteAccuracy");
  const correctionEffort = number("correctionEffort");
  const approvalMinutes = number("approvalMinutes");
  const usefulness = number("usefulness");
  const missingInformation = String(formData.get("missingInformation") ?? "").trim();
  const comments = String(formData.get("comments") ?? "").trim();
  const pilotInterest = String(formData.get("pilotInterest") ?? "");
  if (![noteAccuracy, correctionEffort, usefulness].every((value) => Number.isInteger(value) && value >= 1 && value <= 5)) {
    return { message: "Choose a rating for accuracy, correction effort, and usefulness." };
  }
  if (!Number.isInteger(approvalMinutes) || approvalMinutes < 0 || approvalMinutes > 240) {
    return { message: "Enter an approval time between 0 and 240 minutes." };
  }
  if (!missingInformation || missingInformation.length > 2000 || comments.length > 2000 || !["yes", "maybe", "no"].includes(pilotInterest)) {
    return { message: "Complete the required feedback fields and keep responses under 2,000 characters." };
  }
  const { supabase, clinician } = await requireClinician();
  const { error } = await supabase.from("evaluation_feedback").insert({
    clinician_id: clinician.id,
    note_accuracy: noteAccuracy,
    missing_information: missingInformation,
    correction_effort: correctionEffort,
    approval_minutes: approvalMinutes,
    usefulness,
    pilot_interest: pilotInterest,
    comments: comments || null,
  });
  return error ? { message: "We couldn’t save your feedback. Your responses are still here." } : { ok: true, message: "Thank you. Your feedback was saved." };
}

export async function restoreFictionalWorkspace() {
  const { supabase } = await requireClinician();
  const { error } = await supabase.rpc("restore_fictional_workspace");
  if (error) return { ok: false, message: "The fictional workspace could not be restored." };
  revalidatePath("/", "layout");
  return { ok: true, message: "Fictional patients, sessions, follow-ups, and reliability fixtures were restored." };
}
