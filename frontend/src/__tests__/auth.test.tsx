import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { LoginPage } from '../features/auth/LoginPage';
import { api, ApiError, getSessionUser, getToken } from '../shared/api';
import { AuthProvider, useAuth } from '../shared/auth';

vi.mock('../shared/api', async (orig) => {
  const actual = await orig<typeof import('../shared/api')>();
  return { ...actual, api: { ...actual.api, login: vi.fn(), me: vi.fn() } };
});

const login = vi.mocked(api.login);

function Gate() {
  const { user } = useAuth();
  return user ? <p>Signed in as {user.username}</p> : <LoginPage />;
}

function renderApp() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <AuthProvider><Gate /></AuthProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => { window.localStorage.clear(); login.mockReset(); });

describe('sign-in', () => {
  it('rejects wrong credentials without storing anything', async () => {
    login.mockRejectedValue(new ApiError(401, 'UNAUTHORIZED', 'Invalid username or password'));
    renderApp();
    await userEvent.type(screen.getByLabelText('Username'), 'alice');
    await userEvent.type(screen.getByLabelText('Password'), 'nope');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid username or password.');
    expect(getToken()).toBeNull();
    expect(screen.getByLabelText('Password')).toHaveValue('');
  });

  it('stores the session and enters the app on success', async () => {
    login.mockResolvedValue({
      token: 'header.payload.sig',
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      user: { id: 'u-bob', username: 'bob', displayName: 'Bob (reviewer)', tenantId: 't', tenantName: 'Demo', globalRole: 'USER' },
    });
    renderApp();
    await userEvent.click(screen.getByRole('button', { name: /use demo account bob/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Signed in as bob')).toBeInTheDocument();
    expect(login).toHaveBeenCalledWith('bob', 'Test123');
    expect(getToken()).toBe('header.payload.sig');
    expect(getSessionUser()?.id).toBe('u-bob');
  });

  it('marks empty fields red on submit and clears them as the user types', async () => {
    renderApp();
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter your username and password.');
    expect(screen.getByLabelText('Username')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true');
    await userEvent.type(screen.getByLabelText('Username'), 'alice');
    expect(screen.getByLabelText('Username')).toHaveAttribute('aria-invalid', 'false');
    expect(login).not.toHaveBeenCalled();
  });

  it('treats an expired stored session as signed out', () => {
    window.localStorage.setItem('cqa.token', 'old');
    window.localStorage.setItem('cqa.session', JSON.stringify({ user: { id: 'u' }, expiresAt: '2000-01-01T00:00:00Z' }));
    renderApp();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(getToken()).toBeNull();
  });
});
