import { render, screen } from '@testing-library/react';
import { TaskEditor } from '../task-editors/TaskEditor';
import { resolveEditor } from '../task-editors/registry-data';
import { assignLanes } from '../task-editors/transcription/timeline';

describe('task-type editor registry', () => {
  it('renders the transcription editor for TRANSCRIPTION', () => {
    render(
      <TaskEditor taskType="TRANSCRIPTION" schemaVersion={1} readOnly={false} onChange={() => {}}
        input={{ audioUrl: '/audio/x.wav', durationMs: 6000 }}
        payload={{ segments: [{ id: 's1', startMs: 0, endMs: 1000, speaker: 'OTHER', label: 'CLEAR', text: 'hi' }] }} />,
    );
    expect(screen.getByTestId('transcription-editor')).toBeInTheDocument();
    expect(screen.queryByTestId('call-scorecard-editor')).not.toBeInTheDocument();
  });

  it('renders the QA scorecard editor for CALL_SCORECARD', () => {
    render(
      <TaskEditor taskType="CALL_SCORECARD" schemaVersion={1} readOnly={false} onChange={() => {}}
        input={{ callTitle: 'Loan call', transcript: [{ speaker: 'AGENT', text: 'Good morning.' }] }}
        payload={{ checks: {}, outcome: null, notes: '' }} />,
    );
    expect(screen.getByTestId('call-scorecard-editor')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Call transcript' })).toHaveTextContent('Good morning.');
  });

  it('shows an explicit message for unsupported types or versions', () => {
    expect(resolveEditor('TRANSCRIPTION', 99)).toBeUndefined();
    render(<TaskEditor taskType="UNKNOWN" schemaVersion={1} readOnly onChange={() => {}} input={{}} payload={{}} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Unsupported task type UNKNOWN');
  });

  it('puts overlapping segments on separate timeline lanes', () => {
    expect(assignLanes([{ startMs: 0, endMs: 3000 }, { startMs: 2000, endMs: 5000 }, { startMs: 3000, endMs: 4000 }])).toEqual([0, 1, 0]);
  });
});
