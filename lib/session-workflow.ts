export const SESSION_WORKFLOW = {
  awaiting_audio: {
    label: "Awaiting audio",
    detail: "Session created; source audio has not been added.",
  },
  audio_ready: {
    label: "Audio ready",
    detail: "Audio is ready for transcription.",
  },
  transcribed: {
    label: "Transcribed",
    detail: "Transcript is ready for speaker review and confirmation.",
  },
  ready_for_review: {
    label: "Review draft",
    detail: "A SOAP draft is ready for clinician review.",
  },
  approved: {
    label: "Approved",
    detail: "The clinician approved this progress note.",
  },
} as const;

export type SessionWorkflowState = keyof typeof SESSION_WORKFLOW;

export function getSessionWorkflowCopy(state: string | null | undefined) {
  if (state && state in SESSION_WORKFLOW) {
    return SESSION_WORKFLOW[state as SessionWorkflowState];
  }

  return { label: "In progress", detail: "Documentation is in progress." };
}
