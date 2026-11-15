import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, clearSession, getSessionUser, SESSION_EXPIRED_EVENT, storeSession } from './api';
import type { SessionUser } from './types';

interface AuthState {
  user: SessionUser | null;
  /** Set when the session ended on its own (token expired / rejected), to explain the sign-in screen. */
  expired: boolean;
  isAdmin: boolean;
  /** Platform operator: runs the platform, belongs to no customer organisation. */
  isOperator: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [user, setUser] = useState<SessionUser | null>(getSessionUser);
  const [expired, setExpired] = useState(false);

  // Validate a stored token once on start-up (it may have been revoked or the user deleted).
  useEffect(() => {
    if (!getSessionUser()) return;
    api.me().then(setUser).catch(() => { /* a 401 fires SESSION_EXPIRED_EVENT below */ });
  }, []);

  useEffect(() => {
    const onExpired = () => { client.clear(); setUser(null); setExpired(true); };
    // Another tab signing in or out changes the shared session.
    const onStorage = (e: StorageEvent) => { if (e.key?.startsWith('cqa.')) { client.clear(); setUser(getSessionUser()); } };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
      window.removeEventListener('storage', onStorage);
    };
  }, [client]);

  const login = useCallback(async (username: string, password: string) => {
    const res = await api.login(username, password);
    client.clear();
    storeSession(res);
    setExpired(false);
    setUser(res.user);
  }, [client]);

  const logout = useCallback(() => {
    clearSession();
    client.clear();
    setExpired(false);
    setUser(null);
  }, [client]);

  const value = useMemo(
    () => ({ user, expired, isAdmin: user?.globalRole === 'ADMIN', isOperator: user?.globalRole === 'OPERATOR', login, logout }),
    [user, expired, login, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
