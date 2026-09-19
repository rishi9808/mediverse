import { createAudioRetentionClient, processDueAudioDeletions } from "@/lib/audio-retention";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await processDueAudioDeletions(createAudioRetentionClient());
    return Response.json({ ok: true, ...result });
  } catch (error) {
    console.error("Audio retention run failed", error instanceof Error ? error.message : "UNKNOWN_ERROR");
    return Response.json({ ok: false, error: "Audio retention run failed" }, { status: 500 });
  }
}
