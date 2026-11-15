import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { AdminHome } from '../features/admin/AdminHome';

vi.mock('../shared/auth', () => ({
  useAuth: () => ({
    user: { id: 'u-admin', username: 'admin', displayName: 'Ada Admin', tenantId: 't-1', tenantName: 'Northbridge Bank', globalRole: 'ADMIN' },
    isAdmin: true, isOperator: false,
  }),
}));

vi.mock('../shared/api', async (orig) => {
  const actual = await orig<typeof import('../shared/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      adminUsers: vi.fn().mockResolvedValue([
        { id: 'u1', username: 'alice', displayName: 'Alice', globalRole: 'USER', memberships: [{ projectId: 'p', projectName: 'P', role: 'ANNOTATOR' }] },
        { id: 'u2', username: 'admin', displayName: 'Ada Admin', globalRole: 'ADMIN', memberships: [] },
      ]),
      dataProjects: vi.fn().mockResolvedValue([
        { id: 'proj-a', name: 'Loan calls', approvedTasks: 2, approvedAudioMs: 65000, releases: 1 },
      ]),
      accessLog: vi.fn().mockResolvedValue([
        { id: 'a1', taskId: 't', taskTitle: 'Identity check before discussing the account', projectName: 'Loan calls', actorName: 'Bob',
          actorUsername: 'bob', sameOrganisation: true, action: 'READ_AUDIO', outcome: 'ALLOWED', createdAt: new Date().toISOString() },
      ]),
    },
  };
});

describe('admin home', () => {
  it('shows an organisation overview and the admin shortcuts instead of an empty notice', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter><AdminHome /></MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Welcome, Ada Admin');
    const overview = await screen.findByLabelText('Organisation overview');
    expect(within(overview).getByText('Users').nextSibling).toHaveTextContent('2');
    expect(within(overview).getByText('Approved tasks').nextSibling).toHaveTextContent('2');
    expect(screen.getByText('1 on a project')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open administration/ })).toHaveAttribute('href', '/admin');
    expect(screen.getByRole('link', { name: /Open releases/ })).toHaveAttribute('href', '/admin/datasets');
    expect(await screen.findByText('Bob played audio of Identity check before discussing the account')).toBeInTheDocument();
  });
});
