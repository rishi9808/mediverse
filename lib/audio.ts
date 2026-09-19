export const MAX_AUDIO_BYTES = 50 * 1024 * 1024;
export const MAX_AUDIO_DURATION_MS = 90 * 60 * 1000;

export const SUPPORTED_AUDIO_MIME_TYPES = [
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/aac",
] as const;

export type SupportedAudioMimeType = (typeof SUPPORTED_AUDIO_MIME_TYPES)[number];
export type AudioSource = "recording" | "upload";

const MIME_ALIASES: Record<string, SupportedAudioMimeType> = {
  "audio/mp3": "audio/mpeg",
  "audio/m4a": "audio/mp4",
  "audio/x-m4a": "audio/mp4",
  "audio/vnd.wave": "audio/wav",
};

const EXTENSION_MIME_TYPES: Record<string, SupportedAudioMimeType> = {
  aac: "audio/aac",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  mp4: "audio/mp4",
  oga: "audio/ogg",
  ogg: "audio/ogg",
  wav: "audio/wav",
  webm: "audio/webm",
};

export function normalizeAudioMimeType(type: string, fileName = ""): SupportedAudioMimeType | null {
  const baseType = type.toLowerCase().split(";", 1)[0].trim();
  const aliasedType = MIME_ALIASES[baseType] ?? baseType;
  if ((SUPPORTED_AUDIO_MIME_TYPES as readonly string[]).includes(aliasedType)) {
    return aliasedType as SupportedAudioMimeType;
  }

  const extension = fileName.toLowerCase().split(".").pop() ?? "";
  return EXTENSION_MIME_TYPES[extension] ?? null;
}

export function selectRecordingMimeType(): SupportedAudioMimeType | null {
  if (typeof MediaRecorder === "undefined") return null;

  for (const candidate of ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"]) {
    if (MediaRecorder.isTypeSupported(candidate)) {
      return normalizeAudioMimeType(candidate);
    }
  }

  return null;
}
