import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { UserDialog } from '../features/admin/UserDialog';
import { api } from '../shared/api';

vi.mock('../shared/api', async (orig) => {
  const actual = await orig<typeof import('../shared/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      dataProjects: vi.fn().mockResolvedValue([
        { id: 'proj-a', name: 'Loan calls', approvedTasks: 0, approvedAudioMs: 0, releases: 0 },
        { id: 'proj-c', name: 'Mortgage follow-ups', approvedTasks: 0, approvedAudioMs: 0, releases: 0 },
      ]),
      createUser: vi.fn(),
      updateUser: vi.fn(),
    },
  };
});

const createUser = vi.mocked(api.createUser);
const updateUser = vi.mocked(api.updateUser);

function renderDialog(props: Partial<Parameters<typeof UserDialog>[0]> = {}) {
  const onSaved = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <UserDialog onClose={() => {}} onSaved={onSaved} {...props} />
    </QueryClientProvider>,
  );
  return { onSaved };
}

const field = (name: RegExp) => screen.getByRole('textbox', { name });

beforeEach(() => { createUser.mockReset(); updateUser.mockReset(); });

describe('user dialog', () => {
  it('marks every invalid field red and sends nothing', async () => {
    renderDialog();
    await userEvent.type(field(/Username/), 'A!');
    await userEvent.type(screen.getByLabelText(/^Password/), 'short');
    await userEvent.click(screen.getByRole('button', { name: 'Add user' }));
    expect(field(/Username/)).toHaveAttribute('aria-invalid', 'true');
    expect(field(/Full name/)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(/^Password/)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Full name is required')).toBeInTheDocument();
    expect(createUser).not.toHaveBeenCalled();
  });

  it('creates a user with the chosen project roles', async () => {
    createUser.mockResolvedValue({ id: 'u-1', username: 'frank', displayName: 'Frank Weber', globalRole: 'USER', memberships: [] });
    const { onSaved } = renderDialog();
    await userEvent.type(field(/Username/), 'Frank');
    await userEvent.type(field(/Full name/), 'Frank Weber');
    await userEvent.type(screen.getByLabelText(/^Password/), 'Welcome1');
    await userEvent.click(await screen.findByRole('combobox', { name: 'Mortgage follow-ups' }));
    await userEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Reviewer' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add user' }));
    expect(createUser).toHaveBeenCalledWith({
      username: 'frank', displayName: 'Frank Weber', password: 'Welcome1', globalRole: 'USER',
      memberships: [{ projectId: 'proj-c', role: 'REVIEWER' }],
    });
    expect(onSaved).toHaveBeenCalledWith('Frank Weber added');
  });

  it('edits without a password, keeps the username fixed and locks your own admin role', async () => {
    updateUser.mockResolvedValue({ id: 'u-dana', username: 'admin', displayName: 'Dana F.', globalRole: 'ADMIN', memberships: [] });
    renderDialog({ user: { id: 'u-dana', username: 'admin', displayName: 'Dana Fischer', globalRole: 'ADMIN', memberships: [] }, isSelf: true });
    expect(field(/Username/)).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Account role' })).toHaveAttribute('aria-disabled', 'true');
    expect(await screen.findByRole('combobox', { name: 'Loan calls' })).toHaveAttribute('aria-disabled', 'true');
    await userEvent.clear(field(/Full name/));
    await userEvent.type(field(/Full name/), 'Dana F.');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(updateUser).toHaveBeenCalledWith('u-dana', { displayName: 'Dana F.', globalRole: 'ADMIN', memberships: [] });
  });
});
