import type {
  AccessLogEntry, AccountEvent, AdminUser, UserInput, DatasetRelease, DatasetReleaseDetail, ProjectData, TenantOverview, AnnotationView, AuditEvent, EvaluationReport, LoginResponse, Project, SessionUser, TaskDetail, TaskPage, TaskStatus,
} from './types';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public violations: string[] = []) {
    super(message);
    this.name = 'ApiError';
  }
  get isStale(): boolean { return this.status === 409 && this.code === 'STALE_VERSION'; }
}

/*
 * Session = bearer token + the signed-in user, kept in localStorage so every tab of this browser shares it
 * (needed for the two-tab conflict demo). The token is only ever sent in the Authorization header.
 */
const TOKEN_KEY = 'cqa.token';
const SESSION_KEY = 'cqa.session';
/** Fired when the server rejects the token (expired / revoked): the app returns to the sign-in screen. */
export const SESSION_EXPIRED_EVENT = 'cqa:session-expired';

interface StoredSession { user: SessionUser; expiresAt: string }

function read(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

export function getToken(): string | null { return read(TOKEN_KEY); }

export function getSessionUser(): SessionUser | null {
  const raw = read(SESSION_KEY);
  if (!raw || !getToken()) return null;
  try {
    const s = JSON.parse(raw) as StoredSession;
    if (new Date(s.expiresAt).getTime() <= Date.now()) { clearSession(); return null; }
    return s.user;
  } catch { return null; }
}

export function storeSession(login: LoginResponse): void {
  try {
    window.localStorage.setItem(TOKEN_KEY, login.token);
    window.localStorage.setItem(SESSION_KEY, JSON.stringify({ user: login.user, expiresAt: login.expiresAt } satisfies StoredSession));
  } catch { /* storage unavailable: the session lasts until reload */ }
}

export function clearSession(): void {
  try { window.localStorage.removeItem(TOKEN_KEY); window.localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
}

export function getCurrentUserId(): string | null {
  return getSessionUser()?.id ?? null;
}

/** Binary download through the API with the session token (e.g. task recordings); same 401 handling as JSON calls. */
export async function fetchProtected(path: string): Promise<ArrayBuffer> {
  const token = getToken();
  const res = await fetch(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) {
    if (res.status === 401) {
      clearSession();
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    }
    throw new ApiError(res.status, 'ERROR', res.statusText);
  }
  return res.arrayBuffer();
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const token = getToken();
  if (token && path !== '/api/auth/login') headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    if (res.status === 401 && path !== '/api/auth/login') {
      clearSession();
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    }
    throw new ApiError(res.status, data?.code ?? 'ERROR', data?.message ?? res.statusText, data?.violations ?? []);
  }
  return data as T;
}

export const api = {
  login: (username: string, password: string) => request<LoginResponse>('POST', '/api/auth/login', { username, password }),
  me: () => request<SessionUser>('GET', '/api/auth/me'),
  adminUsers: () => request<AdminUser[]>('GET', '/api/admin/users'),
  createUser: (input: UserInput) => request<AdminUser>('POST', '/api/admin/users', input),
  updateUser: (id: string, input: UserInput) => request<AdminUser>('PUT', `/api/admin/users/${id}`, input),
  accountEvents: () => request<AccountEvent[]>('GET', '/api/admin/account-events'),
  dataProjects: () => request<ProjectData[]>('GET', '/api/admin/projects'),
  releases: (projectId: string) => request<DatasetRelease[]>('GET', `/api/admin/projects/${projectId}/datasets`),
  createRelease: (projectId: string) => request<DatasetRelease>('POST', `/api/admin/projects/${projectId}/datasets`),
  releaseDetail: (releaseId: string) => request<DatasetReleaseDetail>('GET', `/api/admin/datasets/${releaseId}`),
  accessLog: (limit = 100) => request<AccessLogEntry[]>('GET', `/api/admin/access-log?limit=${limit}`),
  resetDemo: () => request<void>('POST', '/api/demo/reset'),
  platformTenants: () => request<TenantOverview[]>('GET', '/api/platform/tenants'),
  myProjects: () => request<Project[]>('GET', '/api/me/projects'),
  listTasks: (projectId: string, filter: { status?: TaskStatus; type?: string; q?: string; page?: number; size?: number } = {}) => {
    const q = new URLSearchParams();
    if (filter.status) q.set('status', filter.status);
    if (filter.type) q.set('type', filter.type);
    if (filter.q) q.set('q', filter.q);
    if (filter.page) q.set('page', String(filter.page));
    if (filter.size) q.set('size', String(filter.size));
    const qs = q.toString();
    return request<TaskPage>('GET', `/api/projects/${projectId}/tasks${qs ? `?${qs}` : ''}`);
  },
  getTask: (id: string) => request<TaskDetail>('GET', `/api/tasks/${id}`),
  saveAnnotation: (id: string, expectedVersion: number, payload: unknown) =>
    request<AnnotationView>('PUT', `/api/tasks/${id}/annotation`, { expectedVersion, payload }),
  submitTask: (id: string, expectedVersion: number) =>
    request<TaskDetail>('POST', `/api/tasks/${id}/submit`, { expectedVersion }),
  reviewTask: (id: string, decision: 'APPROVE' | 'REQUEST_CHANGES', comment: string) =>
    request<TaskDetail>('POST', `/api/tasks/${id}/review`, { decision, comment }),
  audit: (id: string) => request<AuditEvent[]>('GET', `/api/tasks/${id}/audit`),
  evaluation: (projectId: string) => request<EvaluationReport>('GET', `/api/projects/${projectId}/evaluation`),
};
