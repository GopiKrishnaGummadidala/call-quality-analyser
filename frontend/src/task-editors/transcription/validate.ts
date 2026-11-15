import type { TranscriptionPayload } from './types';

/** Mirrors the server's submit rules so the annotator gets feedback before a round-trip. */
export function validateTranscription(payload: TranscriptionPayload): string[] {
  const errors: string[] = [];
  if (payload.segments.length === 0) errors.push('Add at least one segment before submitting');
  payload.segments.forEach((s, i) => {
    const n = i + 1;
    if (s.text.trim() === '') errors.push(`Segment ${n}: transcript text is required`);
    if (s.endMs <= s.startMs) errors.push(`Segment ${n}: end time must be after start time`);
    if (s.startMs < 0) errors.push(`Segment ${n}: start time must not be negative`);
  });
  return errors;
}
