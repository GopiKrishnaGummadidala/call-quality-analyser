/** A validation message tied to one field of one segment (`Segment 2: transcript text is required`). */
export interface SegmentFieldErrors { text?: string; start?: string; end?: string }

const SEGMENT_MESSAGE = /^Segment (\d+): (.+)$/;

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Maps submit-validation messages (the same wording the server uses) onto segment fields, so editors can mark the
 * exact field red instead of only listing the problem. Messages that name no field are left to the summary.
 */
export function segmentFieldErrors(errors: readonly string[]): Map<number, SegmentFieldErrors> {
  const out = new Map<number, SegmentFieldErrors>();
  for (const message of errors) {
    const m = SEGMENT_MESSAGE.exec(message);
    if (!m) continue;
    const index = Number(m[1]) - 1;
    const text = sentence(m[2]);
    const entry = out.get(index) ?? {};
    if (/transcript text/i.test(m[2])) entry.text = text;
    else if (/end time/i.test(m[2])) entry.end = text;
    else if (/start time/i.test(m[2])) entry.start = text;
    else entry.text ??= text;
    out.set(index, entry);
  }
  return out;
}
