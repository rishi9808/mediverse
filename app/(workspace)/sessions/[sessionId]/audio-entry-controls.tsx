"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as tus from "tus-js-client";

import {
  finalizeAudioAsset,
  prepareAudioAsset,
  saveAudioAcknowledgment,
  type PreparedAudioAsset,
} from "../../actions";
import {
  MAX_AUDIO_BYTES,
  MAX_AUDIO_DURATION_MS,
  normalizeAudioMimeType,
  selectRecordingMimeType,
  type AudioSource,
  type SupportedAudioMimeType,
} from "@/lib/audio";
import {
  AUDIO_UPLOAD_ACKNOWLEDGMENT,
  RECORDING_ACKNOWLEDGMENT,
} from "@/lib/recording-consent";
import { createClient } from "@/lib/supabase/client";

const TUS_CHUNK_SIZE = 6 * 1024 * 1024;

type PendingAudio = {
  blob: Blob;
  durationMs: number;
  mimeType: SupportedAudioMimeType;
};

type CaptureState = "idle" | "recording" | "paused" | "stopping";
type StopReason = "manual" | "duration" | "size" | "interruption";

function formatAcknowledgmentTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatElapsed(milliseconds: number) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => value.toString().padStart(2, "0")).join(":");
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function resumableEndpoint() {
  const projectUrl = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  const projectId = projectUrl.hostname.endsWith(".supabase.co")
    ? projectUrl.hostname.split(".")[0]
    : null;
  return projectId
    ? `https://${projectId}.storage.supabase.co/storage/v1/upload/resumable`
    : `${projectUrl.origin}/storage/v1/upload/resumable`;
}

function readAudioDuration(file: File) {
  return new Promise<number>((resolve, reject) => {
    const audio = document.createElement("audio");
    const objectUrl = URL.createObjectURL(file);
    const timeout = window.setTimeout(() => finish(() => reject(new Error("Audio metadata timed out."))), 15000);

    function finish(callback: () => void) {
      window.clearTimeout(timeout);
      audio.removeAttribute("src");
      audio.load();
      URL.revokeObjectURL(objectUrl);
      callback();
    }

    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      const durationMs = Math.round(audio.duration * 1000);
      if (!Number.isFinite(durationMs) || durationMs < 1) {
        finish(() => reject(new Error("Audio duration is unavailable.")));
        return;
      }
      finish(() => resolve(durationMs));
    };
    audio.onerror = () => finish(() => reject(new Error("Audio metadata could not be read.")));
    audio.src = objectUrl;
  });
}

async function uploadWithTus(
  asset: PreparedAudioAsset,
  audio: PendingAudio,
  onProgress: (percentage: number) => void,
  uploadRef: React.MutableRefObject<tus.Upload | null>,
) {
  const supabase = createClient();
  const { data, error } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (error || !accessToken) throw new Error("Your session expired. Sign in and retry the upload.");

  await new Promise<void>(async (resolve, reject) => {
    const upload = new tus.Upload(audio.blob, {
      endpoint: resumableEndpoint(),
      uploadSize: audio.blob.size,
      chunkSize: TUS_CHUNK_SIZE,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: { Authorization: `Bearer ${accessToken}` },
      metadata: {
        bucketName: asset.bucketId,
        objectName: asset.objectPath,
        contentType: audio.mimeType,
        cacheControl: "3600",
      },
      fingerprint: async () =>
        `mediverse-${asset.id}-${audio.blob.size}-${audio.mimeType}`,
      removeFingerprintOnSuccess: true,
      onProgress: (uploaded, total) => onProgress(Math.round((uploaded / total) * 100)),
      onSuccess: () => resolve(),
      onError: (uploadError) => reject(uploadError),
    });
    uploadRef.current = upload;

    try {
      const previousUploads = await upload.findPreviousUploads();
      const matchingUpload = previousUploads.find((previous) => previous.size === audio.blob.size);
      if (matchingUpload) upload.resumeFromPreviousUpload(matchingUpload);
      upload.start();
    } catch (resumeError) {
      reject(resumeError);
    }
  });
}

export function AudioEntryControls({
  initialAcknowledgedAt,
  initialAssetMimeType,
  initialSource,
  sessionId,
}: {
  initialAcknowledgedAt: string | null;
  initialAssetMimeType: string | null;
  initialSource: string;
  sessionId: string;
}) {
  const router = useRouter();
  const lockedSource = initialSource === "recording" || initialSource === "upload"
    ? initialSource
    : null;
  const [source, setSource] = useState<AudioSource>(lockedSource ?? "recording");
  const [selectedSource, setSelectedSource] = useState<AudioSource | null>(lockedSource);
  const [popupSource, setPopupSource] = useState<AudioSource | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [savingAcknowledgment, setSavingAcknowledgment] = useState(false);
  const [acknowledgedAt, setAcknowledgedAt] = useState(initialAcknowledgedAt);
  const [captureState, setCaptureState] = useState<CaptureState>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [pendingAudio, setPendingAudio] = useState<PendingAudio | null>(null);
  const [selectedFileName, setSelectedFileName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const bytesRef = useRef(0);
  const accumulatedMsRef = useRef(0);
  const segmentStartedAtRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const stopReasonRef = useRef<StopReason>("manual");
  const tusUploadRef = useRef<tus.Upload | null>(null);
  const activeUploadRef = tusUploadRef;

  function clearTimer() {
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = null;
  }

  function currentElapsed() {
    const recorder = recorderRef.current;
    if (recorder?.state === "recording") {
      return accumulatedMsRef.current + (performance.now() - segmentStartedAtRef.current);
    }
    return accumulatedMsRef.current;
  }

  function releaseMicrophone() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  function requestStop(reason: StopReason) {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;

    stopReasonRef.current = reason;
    if (recorder.state === "recording") {
      accumulatedMsRef.current = Math.min(
        MAX_AUDIO_DURATION_MS,
        accumulatedMsRef.current + (performance.now() - segmentStartedAtRef.current),
      );
    }
    setElapsedMs(accumulatedMsRef.current);
    clearTimer();
    setCaptureState("stopping");
    recorder.stop();
    releaseMicrophone();
  }

  function startTimer() {
    clearTimer();
    timerRef.current = window.setInterval(() => {
      const nextElapsed = currentElapsed();
      setElapsedMs(nextElapsed);
      if (nextElapsed >= MAX_AUDIO_DURATION_MS) requestStop("duration");
    }, 250);
  }

  useEffect(() => {
    const abortActiveUpload = () => {
      void activeUploadRef.current?.abort();
    };
    window.addEventListener("pagehide", abortActiveUpload);
    return () => {
      window.removeEventListener("pagehide", abortActiveUpload);
      clearTimer();
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }
      releaseMicrophone();
      abortActiveUpload();
    };
  }, [activeUploadRef]);

  useEffect(() => {
    if (captureState !== "recording" && captureState !== "paused") return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [captureState]);

  useEffect(() => {
    if (!popupSource) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !savingAcknowledgment) {
        setPopupSource(null);
        setConfirmed(false);
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [popupSource, savingAcknowledgment]);

  async function finalize(asset: PreparedAudioAsset, audio: PendingAudio) {
    return finalizeAudioAsset(sessionId, asset.id, audio.durationMs, audio.blob.size);
  }

  async function uploadAudio(audio: PendingAudio) {
    setUploading(true);
    setUploadProgress(0);
    setErrorMessage("");
    setMessage("Preparing a private resumable upload…");

    const prepared = await prepareAudioAsset(
      sessionId,
      audio.mimeType,
      audio.durationMs,
      audio.blob.size,
    );
    if (!prepared.ok) {
      setUploading(false);
      setErrorMessage(prepared.message);
      return;
    }

    if (prepared.asset.state !== "verified") {
      try {
        await uploadWithTus(prepared.asset, audio, setUploadProgress, tusUploadRef);
      } catch {
        // A response can be lost after Storage commits the object. Finalization
        // is the authoritative recovery check and is safe to repeat.
        const recovered = await finalize(prepared.asset, audio);
        if (!recovered.ok) {
          setUploading(false);
          setErrorMessage("Upload interrupted. Your session is unchanged; choose Retry upload to resume.");
          setMessage("");
          return;
        }
        setUploading(false);
        setPendingAudio(null);
        setMessage("Audio uploaded securely.");
        router.refresh();
        return;
      }
    }

    const finalized = await finalize(prepared.asset, audio);
    setUploading(false);
    if (!finalized.ok) {
      setErrorMessage(finalized.message);
      setMessage("");
      return;
    }

    setUploadProgress(100);
    setPendingAudio(null);
    setMessage("Audio uploaded securely.");
    router.refresh();
  }

  async function beginRecording() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setErrorMessage("Audio recording is not supported in this browser.");
      return;
    }
    const mimeType = selectRecordingMimeType();
    if (!mimeType) {
      setErrorMessage("This browser does not offer a supported recording format.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType });
      streamRef.current = stream;
      recorderRef.current = recorder;
      chunksRef.current = [];
      bytesRef.current = 0;
      accumulatedMsRef.current = 0;
      setElapsedMs(0);
      setPendingAudio(null);
      setErrorMessage("");
      setMessage("");
      stopReasonRef.current = "manual";

      recorder.ondataavailable = (event) => {
        if (!event.data.size) return;
        chunksRef.current.push(event.data);
        bytesRef.current += event.data.size;
        if (bytesRef.current > MAX_AUDIO_BYTES) requestStop("size");
      };
      recorder.onerror = () => requestStop("interruption");
      recorder.onstop = () => {
        clearTimer();
        releaseMicrophone();
        const durationMs = Math.max(1, Math.round(accumulatedMsRef.current));
        const blob = new Blob(chunksRef.current, { type: mimeType });
        chunksRef.current = [];
        recorderRef.current = null;
        setCaptureState("idle");

        if (blob.size > MAX_AUDIO_BYTES || stopReasonRef.current === "size") {
          setErrorMessage("Recording reached the 50 MiB limit and was stopped. Record a shorter session.");
          return;
        }
        if (!blob.size) {
          setErrorMessage("No audio was captured. Check the microphone and try again.");
          return;
        }

        const captured = { blob, durationMs, mimeType };
        setPendingAudio(captured);
        setMessage(
          stopReasonRef.current === "interruption"
            ? "Microphone interrupted. Uploading the audio captured so far…"
            : stopReasonRef.current === "duration"
              ? "The 90-minute limit was reached. Uploading the recording…"
              : "Recording stopped. Uploading securely…",
        );
        void uploadAudio(captured);
      };
      for (const track of stream.getAudioTracks()) {
        track.addEventListener("ended", () => requestStop("interruption"), { once: true });
      }

      segmentStartedAtRef.current = performance.now();
      recorder.start(1000);
      setCaptureState("recording");
      startTimer();
    } catch {
      releaseMicrophone();
      recorderRef.current = null;
      setCaptureState("idle");
      setErrorMessage("Microphone access was not granted. Recording did not start.");
    }
  }

  function pauseRecording() {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== "recording") return;
    accumulatedMsRef.current += performance.now() - segmentStartedAtRef.current;
    setElapsedMs(accumulatedMsRef.current);
    recorder.pause();
    clearTimer();
    setCaptureState("paused");
  }

  function resumeRecording() {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== "paused") return;
    recorder.resume();
    segmentStartedAtRef.current = performance.now();
    setCaptureState("recording");
    startTimer();
  }

  async function chooseFile(file: File | null) {
    setErrorMessage("");
    setMessage("");
    setPendingAudio(null);
    setSelectedFileName("");
    if (!file) return;
    const mimeType = normalizeAudioMimeType(file.type, file.name);
    if (!mimeType) {
      setErrorMessage("Choose a WebM, OGG, MP4/M4A, MP3, WAV, or AAC audio file.");
      return;
    }
    if (initialAssetMimeType && initialAssetMimeType !== mimeType) {
      setErrorMessage(`Retry with the original ${initialAssetMimeType} audio format.`);
      return;
    }
    if (file.size < 1 || file.size > MAX_AUDIO_BYTES) {
      setErrorMessage("Audio files must be no larger than 50 MiB.");
      return;
    }

    try {
      const durationMs = await readAudioDuration(file);
      if (durationMs > MAX_AUDIO_DURATION_MS) {
        setErrorMessage("Audio files must be no longer than 90 minutes.");
        return;
      }
      setSelectedFileName(file.name);
      setPendingAudio({ blob: file, durationMs, mimeType });
      setMessage(`${file.name} · ${formatElapsed(durationMs)} · ${formatBytes(file.size)}`);
    } catch {
      setErrorMessage("We couldn’t read this audio file. Choose another supported file.");
    }
  }

  function requestAcknowledgment(requestedSource: AudioSource) {
    setErrorMessage("");
    if (requestedSource === "upload" && !pendingAudio) {
      setErrorMessage("Choose a supported audio file first.");
      return;
    }
    setConfirmed(false);
    setPopupSource(requestedSource);
  }

  async function confirmAudioEntry(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!popupSource || !confirmed || savingAcknowledgment) return;
    setSavingAcknowledgment(true);
    setErrorMessage("");
    const requestedSource = popupSource;
    const result = await saveAudioAcknowledgment(sessionId, requestedSource);
    if (!result.ok) {
      setErrorMessage(result.message);
      setSavingAcknowledgment(false);
      return;
    }

    setAcknowledgedAt(result.recordedAt);
    setSelectedSource(result.source);
    setSource(result.source);
    setPopupSource(null);
    setConfirmed(false);
    setSavingAcknowledgment(false);
    if (result.source === "recording") await beginRecording();
    else if (pendingAudio) await uploadAudio(pendingAudio);
  }

  const sourceLocked = selectedSource !== null;
  const busy = uploading || captureState !== "idle";

  return (
    <div className="audio-entry-controls">
      <div className="audio-source-tabs" aria-label="Audio source">
        <button
          aria-pressed={source === "recording"}
          className={source === "recording" ? "active" : ""}
          disabled={sourceLocked && selectedSource !== "recording"}
          type="button"
          onClick={() => setSource("recording")}
        >
          Record in browser
        </button>
        <button
          aria-pressed={source === "upload"}
          className={source === "upload" ? "active" : ""}
          disabled={sourceLocked && selectedSource !== "upload"}
          type="button"
          onClick={() => setSource("upload")}
        >
          Upload audio
        </button>
      </div>

      {source === "recording" ? (
        <div className="recording-panel">
          <div className="recording-clock" aria-live="polite">
            <span className={captureState === "recording" ? "live-dot" : ""} aria-hidden="true" />
            <strong>{formatElapsed(elapsedMs)}</strong>
            <small>{captureState === "paused" ? "Paused" : captureState === "recording" ? "Recording" : "Ready"}</small>
          </div>
          <div className="recording-buttons">
            {captureState === "idle" && !uploading && (
              <button className="primary-button" type="button" onClick={() => requestAcknowledgment("recording")}>
                Start recording
              </button>
            )}
            {captureState === "recording" && (
              <button className="secondary-button" type="button" onClick={pauseRecording}>Pause</button>
            )}
            {captureState === "paused" && (
              <button className="secondary-button" type="button" onClick={resumeRecording}>Resume</button>
            )}
            {(captureState === "recording" || captureState === "paused") && (
              <button className="stop-recording-button" type="button" onClick={() => requestStop("manual")}>
                <span aria-hidden="true" /> Stop
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="upload-panel">
          <label className="audio-file-picker">
            <span>{selectedFileName || "Choose an audio file"}</span>
            <input
              accept="audio/webm,audio/ogg,audio/mp4,audio/mpeg,audio/wav,audio/x-wav,audio/aac,.m4a,.mp3,.wav,.ogg,.oga,.webm,.aac,.mp4"
              disabled={busy}
              type="file"
              onChange={(event) => void chooseFile(event.target.files?.[0] ?? null)}
            />
          </label>
          {!uploading && (
            <button
              className="primary-button"
              disabled={!pendingAudio}
              type="button"
              onClick={() => requestAcknowledgment("upload")}
            >
              Upload audio
            </button>
          )}
        </div>
      )}

      <p className="audio-limits">Supported audio · Maximum 90 minutes · Maximum 50 MiB</p>

      {uploading && (
        <div className="upload-progress" aria-live="polite">
          <div><span>Uploading securely</span><strong>{uploadProgress}%</strong></div>
          <progress max="100" value={uploadProgress}>{uploadProgress}%</progress>
        </div>
      )}
      {pendingAudio && !uploading && errorMessage && (
        <button className="secondary-button retry-upload" type="button" onClick={() => void uploadAudio(pendingAudio)}>
          Retry upload
        </button>
      )}
      {acknowledgedAt && (
        <p className="acknowledgment-meta">Consent acknowledgment saved {formatAcknowledgmentTime(acknowledgedAt)}.</p>
      )}
      {message && <p className="audio-message" role="status">{message}</p>}
      {errorMessage && <p className="audio-error" role="alert">{errorMessage}</p>}

      {popupSource && (
        <div className="dialog-backdrop">
          <section
            aria-labelledby="audio-acknowledgment-title"
            aria-modal="true"
            className="acknowledgment-dialog"
            role="dialog"
          >
            <p className="section-kicker">Before {popupSource === "recording" ? "recording" : "uploading"}</p>
            <h2 id="audio-acknowledgment-title">Confirm patient consent</h2>
            <p className="dialog-intro">This confirmation is saved with the session before audio capture or upload begins.</p>
            <form onSubmit={confirmAudioEntry}>
              <label className="consent-checkbox">
                <input
                  autoFocus
                  checked={confirmed}
                  disabled={savingAcknowledgment}
                  required
                  type="checkbox"
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                <span>{popupSource === "recording" ? RECORDING_ACKNOWLEDGMENT : AUDIO_UPLOAD_ACKNOWLEDGMENT}</span>
              </label>
              <div className="dialog-actions">
                <button
                  className="secondary-button"
                  disabled={savingAcknowledgment}
                  type="button"
                  onClick={() => { setPopupSource(null); setConfirmed(false); }}
                >
                  Cancel
                </button>
                <button className="primary-button" disabled={!confirmed || savingAcknowledgment} type="submit">
                  {savingAcknowledgment ? "Saving…" : popupSource === "recording" ? "Start recording" : "Upload audio"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
