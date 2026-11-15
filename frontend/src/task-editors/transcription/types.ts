export type Speaker = 'AGENT' | 'CUSTOMER' | 'OTHER';
export type SegmentLabel = 'CLEAR' | 'UNCLEAR' | 'CROSSTALK';

export interface Segment {
  id: string;
  startMs: number;
  endMs: number;
  speaker: Speaker;
  label: SegmentLabel;
  text: string;
}
export interface TranscriptionPayload { segments: Segment[] }
/** `audioUrl` is the protected API endpoint for the recording; `audioName` its file name, for display. */
export interface TranscriptionInput { audioUrl: string; audioName?: string; durationMs: number }

export const SPEAKERS: Speaker[] = ['AGENT', 'CUSTOMER', 'OTHER'];
export const LABELS: SegmentLabel[] = ['CLEAR', 'UNCLEAR', 'CROSSTALK'];
