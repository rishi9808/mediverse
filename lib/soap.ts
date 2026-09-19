/** Matches the JSON contract enforced by the database's save_note_revision RPC. */
export type SoapStatement =
  | { text: string; origin: "transcript"; segment_ids: [string, ...string[]] }
  | { text: string; origin: "clinician"; segment_ids: [] };

export type SoapDocument = Record<
  "subjective" | "objective" | "assessment" | "plan",
  SoapStatement[]
>;

export const MAX_AUDIO_DURATION_MS = 90 * 60 * 1000;
export const MAX_AUDIO_BYTES = 50 * 1024 * 1024;
