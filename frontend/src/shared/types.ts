export type Role = 'ANNOTATOR' | 'REVIEWER';
export type GlobalRole = 'USER' | 'ADMIN' | 'OPERATOR';
export type TaskStatus = 'IN_PROGRESS' | 'SUBMITTED' | 'APPROVED' | 'CHANGES_REQUESTED';

export interface SessionUser {
  id: string; username: string; displayName: string; tenantId: string; tenantName: string; globalRole: GlobalRole;
}
export interface LoginResponse { token: string; expiresAt: string; user: SessionUser }
export interface TenantOverview { id: string; name: string; users: number; projects: number; tasks: number; approvedTasks: number; releases: number }
export interface ProjectData { id: string; name: string; approvedTasks: number; approvedAudioMs: number; releases: number }
export interface DatasetRelease {
  id: string; projectId: string; projectName: string; version: number; createdAt: string; createdByName: string;
  deidPolicy: string; itemCount: number; audioMs: number; splits: Record<'train' | 'val' | 'test', number>;
  redactions: Record<string, number>; manifestSha256: string; downloads: number;
}
export interface DatasetReleaseDetail { release: DatasetRelease; preview: unknown[] }
export interface AccessLogEntry {
  id: string; taskId: string; taskTitle: string; projectName: string;
  actorName: string; actorUsername: string | null; sameOrganisation: boolean;
  action: 'VIEW_TASK' | 'READ_AUDIO'; outcome: 'ALLOWED' | 'DENIED'; createdAt: string;
}
export interface AdminUser {
  id: string; username: string; displayName: string; globalRole: GlobalRole;
  memberships: { projectId: string; projectName: string; role: Role }[];
  updatedAt?: string;
}
export interface Project { id: string; name: string; role: Role }
export interface UserInput {
  username?: string; displayName: string; password?: string; globalRole: 'USER' | 'ADMIN';
  memberships: { projectId: string; role: Role }[];
}
export interface AccountEvent {
  id: string; actorName: string; targetName: string; action: 'USER_CREATED' | 'USER_UPDATED' | 'PASSWORD_RESET';
  details: Record<string, unknown>; createdAt: string;
}

export interface TaskSummary {
  id: string;
  projectId: string;
  taskType: string;
  schemaVersion: number;
  title: string;
  status: TaskStatus;
  assigneeId: string | null;
  assigneeName: string | null;
  version: number;
  updatedAt: string;
}

/** One page of a project's tasks, most recently modified first; counts and projectTotal cover the whole project. */
export interface TaskPage {
  items: TaskSummary[]; total: number; page: number; size: number;
  projectTotal: number; counts: Record<TaskStatus, number>; types: string[];
}

export interface AnnotationView { payload: unknown; version: number; updatedBy: string | null; updatedAt: string }

export interface ReviewView {
  id: string;
  reviewerName: string;
  decision: 'APPROVE' | 'REQUEST_CHANGES';
  comment: string | null;
  createdAt: string;
}

/** The speech model's first draft of a task (model-assisted annotation), with provenance. */
export interface DraftView { modelName: string; modelVersion: string; provenance: string; segments: { id: string; text: string }[] }

export interface TaskDetail extends Omit<TaskSummary, 'updatedAt'> {
  input: unknown;
  viewerRole: Role;
  canEdit: boolean;
  canReview: boolean;
  annotation: AnnotationView;
  lastReview: ReviewView | null;
  draft?: DraftView | null;
}

export interface AuditEvent {
  id: string;
  action: string;
  actorName: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ClipResult {
  clipId: string; reference: string; hypothesis: string;
  substitutions: number; deletions: number; insertions: number; referenceWords: number; wer: number;
}
export interface ModelResult {
  modelName: string; modelVersion: string; provenance: string;
  substitutions: number; deletions: number; insertions: number; referenceWords: number; wer: number;
  clips: ClipResult[];
}
export interface EvaluationReport {
  metric: string; metricDefinition: string; datasetName: string; datasetSize: number;
  totalReferenceWords: number; disclaimer: string; models: ModelResult[];
  draftCorrections?: DraftCorrections | null;
}
export interface DraftCorrections {
  modelName: string; modelVersion: string; provenance: string; approvedTasks: number; segments: number;
  segmentsUnchanged: number; substitutions: number; deletions: number; insertions: number; referenceWords: number; wer: number;
  tasks: { taskId: string; title: string; segments: number; segmentsEdited: number; referenceWords: number; wer: number }[];
}
