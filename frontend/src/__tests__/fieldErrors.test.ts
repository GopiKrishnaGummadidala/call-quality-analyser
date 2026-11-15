import { segmentFieldErrors } from '../task-editors/fieldErrors';

describe('segmentFieldErrors', () => {
  it('maps validation messages onto the field they name', () => {
    const m = segmentFieldErrors([
      'Segment 1: transcript text is required',
      'Segment 2: end time must be after start time',
      'Segment 2: start time must not be negative',
      'Add at least one segment before submitting',
    ]);
    expect(m.get(0)).toEqual({ text: 'Transcript text is required' });
    expect(m.get(1)).toEqual({ end: 'End time must be after start time', start: 'Start time must not be negative' });
    expect(m.size).toBe(2); // messages without a segment stay in the summary only
  });
});
