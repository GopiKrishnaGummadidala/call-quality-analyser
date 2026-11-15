import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { ReviewPanel } from '../features/review/ReviewPanel';
import { api } from '../shared/api';
import type { TaskDetail } from '../shared/types';

vi.mock('../shared/api', async (orig) => {
  const actual = await orig<typeof import('../shared/api')>();
  return { ...actual, api: { reviewTask: vi.fn() } };
});

const review = vi.mocked(api.reviewTask);
const task = { id: 't1' } as TaskDetail;

describe('ReviewPanel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('requires a reason to request changes', async () => {
    render(<ReviewPanel task={task} onDone={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Request changes' }));
    expect(screen.getByRole('alert')).toHaveTextContent('A reason is required');
    expect(screen.getByLabelText(/reason/i)).toHaveAttribute('aria-invalid', 'true');
    expect(review).not.toHaveBeenCalled();
  });

  it('sends the reason with the decision', async () => {
    review.mockResolvedValue(task);
    const onDone = vi.fn();
    render(<ReviewPanel task={task} onDone={onDone} />);
    await userEvent.type(screen.getByLabelText(/reason/i), 'Fix segment 2');
    await userEvent.click(screen.getByRole('button', { name: 'Request changes' }));
    expect(review).toHaveBeenCalledWith('t1', 'REQUEST_CHANGES', 'Fix segment 2');
    expect(onDone).toHaveBeenCalled();
  });

  it('approves without a reason', async () => {
    review.mockResolvedValue(task);
    render(<ReviewPanel task={task} onDone={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(review).toHaveBeenCalledWith('t1', 'APPROVE', '');
  });
});
