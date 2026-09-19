import type { Json } from "@/lib/database.types";

export const DEEPGRAM_TRANSCRIPTION_MODEL = "nova-3";
export const OPENAI_TRANSCRIPTION_MODEL = "gpt-4o-transcribe-diarize";

export type TranscriptionProvider = "deepgram" | "openai";

export type TranscriptionResult = {
  segments: Json[];
  provider: TranscriptionProvider;
  model: string;
};

type ProviderEnvironment = {
  DEEPGRAM_API_KEY?: string;
  OPENAI_API_KEY?: string;
  TRANSCRIPTION_PROVIDER?: string;
};

type AudioInput = {
  audio: Blob;
  mimeType: string;
  durationMs: number;
};

type OpenAISegment = {
  id?: unknown;
  start?: unknown;
  end?: unknown;
  text?: unknown;
  speaker?: unknown;
};

type OpenAIResponse = { segments?: unknown };

type DeepgramUtterance = {
  start?: unknown;
  end?: unknown;
  transcript?: unknown;
  speaker?: unknown;
};

type DeepgramResponse = {
  results?: { utterances?: unknown };
};

const FILE_EXTENSIONS: Record<string, string> = {
  "audio/aac": "aac",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/webm": "webm",
};

function providerErrorCode(provider: TranscriptionProvider, status: number) {
  const prefix = provider.toUpperCase();
  if (status === 401 || status === 403) return `${prefix}_AUTH_UNAVAILABLE`;
  if (status === 429) return `${prefix}_RATE_LIMITED`;
  if (status >= 500) return `${prefix}_UNAVAILABLE`;
  return `${prefix}_TRANSCRIPTION_REJECTED`;
}

function normalizeSegment(
  segment: { id: unknown; speaker: unknown; text: unknown; start: unknown; end: unknown },
  durationMs: number,
  providerIds: Set<string>,
) {
  const id = typeof segment.id === "string" ? segment.id.trim() : "";
  const speaker = typeof segment.speaker === "string" ? segment.speaker.trim() : "";
  const text = typeof segment.text === "string" ? segment.text.trim() : "";
  const rawStartMs = Math.round(Number(segment.start) * 1000);
  const rawEndMs = Math.round(Number(segment.end) * 1000);
  const startMs = Math.max(0, Math.min(rawStartMs, durationMs - 1));
  const endMs = Math.max(startMs + 1, Math.min(rawEndMs, durationMs));

  if (
    !id || id.length > 160 || providerIds.has(id) ||
    !speaker || speaker.length > 80 ||
    !text || text.length > 20_000 ||
    !Number.isFinite(rawStartMs) || !Number.isFinite(rawEndMs) || rawEndMs <= rawStartMs ||
    durationMs < 1
  ) {
    throw new Error("INVALID_PROVIDER_RESPONSE");
  }
  providerIds.add(id);
  return { id, speaker, text, start_ms: startMs, end_ms: endMs } satisfies Json;
}

export function normalizeOpenAIResponse(response: OpenAIResponse, durationMs: number): Json[] {
  if (!Array.isArray(response.segments) || response.segments.length === 0) {
    throw new Error("INVALID_PROVIDER_RESPONSE");
  }

  const providerIds = new Set<string>();
  return (response.segments as OpenAISegment[]).map((segment) => normalizeSegment({
    id: segment.id,
    speaker: segment.speaker,
    text: segment.text,
    start: segment.start,
    end: segment.end,
  }, durationMs, providerIds));
}

export function normalizeDeepgramResponse(response: DeepgramResponse, durationMs: number): Json[] {
  const utterances = response.results?.utterances;
  if (!Array.isArray(utterances) || utterances.length === 0) {
    throw new Error("INVALID_PROVIDER_RESPONSE");
  }

  const providerIds = new Set<string>();
  return (utterances as DeepgramUtterance[]).map((utterance, index) => normalizeSegment({
    id: `deepgram-utterance-${index}`,
    speaker: typeof utterance.speaker === "number" || typeof utterance.speaker === "string"
      ? `speaker_${utterance.speaker}`
      : "",
    text: utterance.transcript,
    start: utterance.start,
    end: utterance.end,
  }, durationMs, providerIds));
}

export function selectTranscriptionProvider(env: ProviderEnvironment): TranscriptionProvider {
  const configured = env.TRANSCRIPTION_PROVIDER?.trim().toLowerCase();
  if (configured && configured !== "deepgram" && configured !== "openai") {
    throw new Error("TRANSCRIPTION_PROVIDER_INVALID");
  }
  if (configured === "deepgram") {
    if (!env.DEEPGRAM_API_KEY) throw new Error("DEEPGRAM_CONFIGURATION_UNAVAILABLE");
    return "deepgram";
  }
  if (configured === "openai") {
    if (!env.OPENAI_API_KEY) throw new Error("OPENAI_CONFIGURATION_UNAVAILABLE");
    return "openai";
  }
  if (env.DEEPGRAM_API_KEY) return "deepgram";
  if (env.OPENAI_API_KEY) return "openai";
  throw new Error("TRANSCRIPTION_CONFIGURATION_UNAVAILABLE");
}

async function transcribeWithDeepgram(input: AudioInput, apiKey: string): Promise<TranscriptionResult> {
  const query = new URLSearchParams({
    model: DEEPGRAM_TRANSCRIPTION_MODEL,
    language: "en-US",
    smart_format: "true",
    punctuate: "true",
    utterances: "true",
    diarize_model: "latest",
    mip_opt_out: "true",
  });
  const response = await fetch(`https://api.deepgram.com/v1/listen?${query}`, {
    method: "POST",
    headers: {
      Authorization: `Token ${apiKey}`,
      "Content-Type": input.mimeType,
    },
    body: input.audio,
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(providerErrorCode("deepgram", response.status));

  const payload = await response.json() as DeepgramResponse;
  return {
    segments: normalizeDeepgramResponse(payload, input.durationMs),
    provider: "deepgram",
    model: DEEPGRAM_TRANSCRIPTION_MODEL,
  };
}

async function transcribeWithOpenAI(input: AudioInput, apiKey: string): Promise<TranscriptionResult> {
  const formData = new FormData();
  const extension = FILE_EXTENSIONS[input.mimeType] ?? "webm";
  formData.append("file", input.audio, `session-audio.${extension}`);
  formData.append("model", OPENAI_TRANSCRIPTION_MODEL);
  formData.append("response_format", "diarized_json");
  formData.append("chunking_strategy", "auto");
  formData.append("language", "en");

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
    signal: AbortSignal.timeout(240_000),
  });
  if (!response.ok) throw new Error(providerErrorCode("openai", response.status));

  const payload = await response.json() as OpenAIResponse;
  return {
    segments: normalizeOpenAIResponse(payload, input.durationMs),
    provider: "openai",
    model: OPENAI_TRANSCRIPTION_MODEL,
  };
}

export async function transcribeAudio(input: AudioInput): Promise<TranscriptionResult> {
  const provider = selectTranscriptionProvider({
    DEEPGRAM_API_KEY: process.env.DEEPGRAM_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    TRANSCRIPTION_PROVIDER: process.env.TRANSCRIPTION_PROVIDER,
  });
  if (provider === "deepgram") {
    return transcribeWithDeepgram(input, process.env.DEEPGRAM_API_KEY as string);
  }
  return transcribeWithOpenAI(input, process.env.OPENAI_API_KEY as string);
}
