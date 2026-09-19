import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeDeepgramResponse,
  normalizeOpenAIResponse,
  selectTranscriptionProvider,
} from '../lib/transcription-provider.ts';

test('Deepgram utterances preserve diarized speakers and bounded timestamps', () => {
  const segments = normalizeDeepgramResponse({
    results: {
      utterances: [
        { start: 0, end: 1.25, transcript: ' How are you? ', speaker: 0 },
        { start: 1.25, end: 2.75, transcript: 'I am feeling better.', speaker: 1 },
      ],
    },
  }, 2_500);

  assert.deepEqual(segments, [
    {
      id: 'deepgram-utterance-0',
      speaker: 'speaker_0',
      text: 'How are you?',
      start_ms: 0,
      end_ms: 1_250,
    },
    {
      id: 'deepgram-utterance-1',
      speaker: 'speaker_1',
      text: 'I am feeling better.',
      start_ms: 1_250,
      end_ms: 2_500,
    },
  ]);
});

test('Deepgram is selected automatically when its key is available', () => {
  assert.equal(selectTranscriptionProvider({
    DEEPGRAM_API_KEY: 'configured',
    OPENAI_API_KEY: 'configured',
  }), 'deepgram');
  assert.equal(selectTranscriptionProvider({
    OPENAI_API_KEY: 'configured',
  }), 'openai');
  assert.equal(selectTranscriptionProvider({
    DEEPGRAM_API_KEY: 'configured',
    OPENAI_API_KEY: 'configured',
    TRANSCRIPTION_PROVIDER: 'openai',
  }), 'openai');
});

test('Provider responses without usable diarized segments are rejected', () => {
  assert.throws(
    () => normalizeDeepgramResponse({ results: {} }, 1_000),
    /INVALID_PROVIDER_RESPONSE/,
  );
  assert.throws(
    () => normalizeOpenAIResponse({
      segments: [{ id: '0', speaker: 'A', text: '', start: 0, end: 1 }],
    }, 1_000),
    /INVALID_PROVIDER_RESPONSE/,
  );
});
