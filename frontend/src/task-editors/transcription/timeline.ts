import type { Segment } from './types';

/**
 * Greedy lane assignment so overlapping segments (allowed: overlapping speech) are drawn on separate rows.
 * Returns a lane index per segment, in the original order.
 */
export function assignLanes(segments: Pick<Segment, 'startMs' | 'endMs'>[]): number[] {
  const order = segments.map((_, i) => i).sort((a, b) => segments[a].startMs - segments[b].startMs);
  const laneEnds: number[] = [];
  const result = new Array<number>(segments.length).fill(0);
  for (const i of order) {
    const s = segments[i];
    let lane = laneEnds.findIndex((end) => end <= s.startMs);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(0); }
    laneEnds[lane] = s.endMs;
    result[i] = lane;
  }
  return result;
}
