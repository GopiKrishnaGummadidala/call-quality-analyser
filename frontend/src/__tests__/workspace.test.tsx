import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { AnnotationWorkspace } from '../features/annotation/AnnotationWorkspace';
import { api, ApiError } from '../shared/api';
import type { TaskDetail } from '../shared/types';

vi.mock('../shared/api', async (orig) => {
  const actual = await orig<typeof import('../shared/api')>();
  return { ...actual, api: { saveAnnotation: vi.fn(), submitTask: vi.fn() } };
});

const save = vi.mocked(api.saveAnnotation);
const submit = vi.mocked(api.submitTask);

function task(overrides: Partial<TaskDetail> = {}, text = ''): TaskDetail {
  return {
    id: 't1', projectId: 'p', taskType: 'TRANSCRIPTION', schemaVersion: 1, title: 'Loan call', status: 'IN_PROGRESS',
    assigneeId: 'u', assigneeName: 'Alice', version: 0, viewerRole: 'ANNOTATOR', canEdit: true, canReview: false, lastReview: null,
    input: { audioUrl: '/audio/a.wav', durationMs: 6000 },
    annotation: {
      version: 0, updatedBy: null, updatedAt: '',
      payload: { segments: [{ id: 's1', startMs: 0, endMs: 1000, speaker: 'OTHER', label: 'CLEAR', text }] },
    },
    ...overrides,
  };
}

beforeEach(() => { vi.clearAllMocks(); });

describe('AnnotationWorkspace', () => {
  it('blocks incomplete submission and explains what to fix', async () => {
    render(<AnnotationWorkspace task={task()} onReload={() => {}} onSubmitted={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /submit for review/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Segment 1: transcript text is required');
    expect(submit).not.toHaveBeenCalled();
  });

  it('starts from the model draft and marks segments the annotator corrected', async () => {
    save.mockResolvedValue({ version: 1 } as never);
    const draft = { modelName: 'whisper-base.en', modelVersion: 'v', provenance: 'Real model output', segments: [{ id: 's1', text: 'walked 10 metres' }] };
    render(<AnnotationWorkspace task={task({ draft }, 'walked 10 metres')} onReload={() => {}} onSubmitted={() => {}} />);
    expect(screen.getByText(/First draft by/)).toHaveTextContent('whisper-base.en');
    expect(screen.getByText('model draft')).toBeInTheDocument();
    expect(screen.getByText('1 of 1 unchanged')).toBeInTheDocument();

    const box = screen.getByLabelText('Segment 1 text');
    await userEvent.clear(box);
    await userEvent.type(box, 'walked ten metres');
    expect(screen.getByText('edited')).toBeInTheDocument();
    expect(screen.getByLabelText('Segment 1 model draft')).toHaveTextContent('Model draft: walked 10 metres');
    expect(screen.getByText('0 of 1 unchanged')).toBeInTheDocument();
  });

  it('marks the invalid field red with its message and clears it once fixed', async () => {
    save.mockResolvedValue({ version: 1 } as never);
    render(<AnnotationWorkspace task={task()} onReload={() => {}} onSubmitted={() => {}} />);
    const box = screen.getByLabelText('Segment 1 text');
    expect(box).not.toHaveAttribute('aria-invalid', 'true'); // nothing is red before a submit attempt

    await userEvent.click(screen.getByRole('button', { name: /submit for review/i }));
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Transcript text is required')).toBeInTheDocument();

    await userEvent.type(box, 'hello');
    expect(box).toHaveAttribute('aria-invalid', 'false');
    expect(screen.queryByText('Transcript text is required')).not.toBeInTheDocument();
  });

  it('shows saving → saved, then submits with the latest version', async () => {
    save.mockResolvedValue({ version: 1 } as never);
    submit.mockResolvedValue(task({ status: 'SUBMITTED', canEdit: false }, 'hello'));
    const onSubmitted = vi.fn();
    render(<AnnotationWorkspace task={task()} onReload={() => {}} onSubmitted={onSubmitted} />);

    await userEvent.type(screen.getByLabelText('Segment 1 text'), 'hello');
    expect(screen.getByRole('status')).toHaveTextContent(/unsaved|saving|saved/i);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('All changes saved'), { timeout: 3000 });
    expect(save).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: /submit for review/i }));
    await waitFor(() => expect(onSubmitted).toHaveBeenCalled());
    expect(submit).toHaveBeenCalledWith('t1', 1);
  });

  it('shows a failed save and lets the user retry', async () => {
    save.mockRejectedValueOnce(new Error('network down')).mockResolvedValueOnce({ version: 1 } as never);
    render(<AnnotationWorkspace task={task()} onReload={() => {}} onSubmitted={() => {}} />);

    await userEvent.type(screen.getByLabelText('Segment 1 text'), 'x');
    expect(await screen.findByText(/could not save: network down/i, {}, { timeout: 3000 })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /retry save/i }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('All changes saved'));
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('stops autosaving on a stale-version conflict and offers reload', async () => {
    save.mockRejectedValue(new ApiError(409, 'STALE_VERSION', 'stale'));
    const onReload = vi.fn();
    render(<AnnotationWorkspace task={task()} onReload={onReload} onSubmitted={() => {}} />);
    await userEvent.type(screen.getByLabelText('Segment 1 text'), 'x');
    expect(await screen.findByText(/was changed elsewhere/i, {}, { timeout: 3000 })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /reload latest/i }));
    expect(onReload).toHaveBeenCalled();
  });

  it('is read-only after submission', () => {
    render(<AnnotationWorkspace task={task({ status: 'SUBMITTED', canEdit: false }, 'done')} onReload={() => {}} onSubmitted={() => {}} />);
    expect(screen.getByLabelText('Segment 1 text')).toHaveAttribute('readonly');
    expect(screen.queryByRole('button', { name: /submit for review/i })).not.toBeInTheDocument();
  });

  it('keyboard shortcuts do not fire while typing, except the intended Ctrl+S', async () => {
    save.mockResolvedValue({ version: 1 } as never);
    render(<AnnotationWorkspace task={task()} onReload={() => {}} onSubmitted={() => {}} />);
    const box = screen.getByLabelText('Segment 1 text');
    await userEvent.type(box, 'k?n'); // would toggle play / help / add-segment if they fired while typing
    expect(box).toHaveValue('k?n');
    expect(screen.queryByLabelText('Keyboard shortcuts')).not.toBeInTheDocument();
    expect(screen.getAllByLabelText(/Segment \d+ text/)).toHaveLength(1);

    await userEvent.type(box, '{Control>}s{/Control}'); // allowed while typing
    await waitFor(() => expect(save).toHaveBeenCalled());
  });
});
