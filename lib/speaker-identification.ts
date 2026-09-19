const MAX_EXCERPTS_PER_SPEAKER = 8;
const MAX_EXCERPT_CHARACTERS = 700;

type SpeakerExcerpt = {
  id: string;
  speaker_key: string;
  start_ms: number;
  end_ms: number;
  content: string;
};

function evenlySpaced<T>(items: T[], limit: number) {
  if (items.length <= limit) return items;
  return Array.from({ length: limit }, (_, index) =>
    items[Math.round(index * (items.length - 1) / (limit - 1))]);
}

export function buildSpeakerIdentificationInput(segments: SpeakerExcerpt[]) {
  const bySpeaker = new Map<string, SpeakerExcerpt[]>();
  for (const segment of segments) {
    const speakerSegments = bySpeaker.get(segment.speaker_key) ?? [];
    speakerSegments.push(segment);
    bySpeaker.set(segment.speaker_key, speakerSegments);
  }

  return Array.from(bySpeaker.values())
    .flatMap((speakerSegments) => evenlySpaced(speakerSegments, MAX_EXCERPTS_PER_SPEAKER))
    .sort((left, right) => left.start_ms - right.start_ms)
    .map((segment) => JSON.stringify({
      speaker_key: segment.speaker_key,
      start_ms: segment.start_ms,
      end_ms: segment.end_ms,
      text: segment.content.slice(0, MAX_EXCERPT_CHARACTERS),
    }))
    .join("\n");
}
