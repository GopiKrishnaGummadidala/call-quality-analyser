import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Alert, AlertTitle, Avatar, Box, Button, Card, Chip, Collapse, Stack, Tooltip, Typography,
} from '@mui/material';
import UndoIcon from '@mui/icons-material/Undo';
import SaveIcon from '@mui/icons-material/SaveOutlined';
import SendIcon from '@mui/icons-material/Send';
import KeyboardIcon from '@mui/icons-material/KeyboardAltOutlined';
import CloudDoneIcon from '@mui/icons-material/CloudDoneOutlined';
import CloudSyncIcon from '@mui/icons-material/CloudSyncOutlined';
import CloudOffIcon from '@mui/icons-material/CloudOffOutlined';
import EditNoteIcon from '@mui/icons-material/EditNote';
import GraphicEqIcon from '@mui/icons-material/GraphicEq';
import NotesIcon from '@mui/icons-material/Notes';
import { api, ApiError } from '../../shared/api';
import { useShortcuts } from '../../shared/shortcuts';
import { useUndoable } from '../../shared/useUndoable';
import { StatusBadge } from '../../shared/StatusBadge';
import { avatarColor, initials } from '../../shared/format';
import type { TaskDetail } from '../../shared/types';
import { TaskEditor } from '../../task-editors/TaskEditor';
import { resolveEditor, taskTypeLabel } from '../../task-editors/registry-data';
import { useAutosave } from './useAutosave';
import type { SaveState } from './useAutosave';

const SAVE_LABEL: Record<SaveState, string> = {
  idle: 'No changes',
  dirty: 'Unsaved changes…',
  saving: 'Saving…',
  saved: 'All changes saved',
  error: 'Save failed',
  conflict: 'Out of date',
};
const SAVE_STYLE: Record<SaveState, { color: string; icon: ReactNode }> = {
  idle: { color: 'text.secondary', icon: <CloudDoneIcon fontSize="small" /> },
  dirty: { color: 'warning.main', icon: <EditNoteIcon fontSize="small" /> },
  saving: { color: 'info.main', icon: <CloudSyncIcon fontSize="small" /> },
  saved: { color: 'success.main', icon: <CloudDoneIcon fontSize="small" /> },
  error: { color: 'error.main', icon: <CloudOffIcon fontSize="small" /> },
  conflict: { color: 'error.main', icon: <CloudOffIcon fontSize="small" /> },
};

const SHORTCUTS: [string, string][] = [
  ['Ctrl+S', 'Save now'],
  ['Ctrl+Enter', 'Submit for review'],
  ['Ctrl+Z', 'Undo last edit (outside text fields)'],
  ['K', 'Play / pause (outside text fields)'],
  ['N', 'New segment at playhead (outside text fields)'],
  ['?', 'Toggle this help'],
];

/** Toolbar labels collapse to icon-only on phones (the buttons keep their aria-label). */
const toolLabel = { display: { xs: 'none', sm: 'inline' } } as const;

interface Props {
  task: TaskDetail;
  onReload: () => void;
  onSubmitted: (task: TaskDetail) => void;
}

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Stack spacing={0.25} sx={{ minWidth: 0 }}>
      <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'text.secondary' }}>{label}</Typography>
      <Box sx={{ fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 1, minHeight: 26 }}>{children}</Box>
    </Stack>
  );
}

/** Generic lifecycle shell (autosave, undo, validation, submit). Task-specific UI is delegated to the registry. */
export function AnnotationWorkspace({ task, onReload, onSubmitted }: Props) {
  const { value, set, undo, canUndo } = useUndoable<unknown>(task.annotation.payload);
  const autosave = useAutosave({
    payload: value,
    initialVersion: task.annotation.version,
    enabled: task.canEdit,
    save: (version, payload) => api.saveAnnotation(task.id, version, payload),
  });
  const [violations, setViolations] = useState<string[]>([]);
  /** Set by the first submit attempt; from then on fields are validated live as the user edits. */
  const [attempted, setAttempted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const def = resolveEditor(task.taskType, task.schemaVersion);

  // After a submit attempt, re-check on every edit so red fields clear as soon as they are fixed.
  useEffect(() => {
    if (attempted && def) setViolations(def.validateForSubmit(value));
  }, [attempted, def, value]);

  async function handleSubmit() {
    if (!task.canEdit || submitting || !def) return;
    setSubmitError(null);
    setAttempted(true);
    const local = def.validateForSubmit(value);
    setViolations(local);
    if (local.length > 0) return; // block incomplete submissions with actionable feedback
    setSubmitting(true);
    try {
      if (!(await autosave.saveNow())) return;
      const updated = await api.submitTask(task.id, autosave.getVersion());
      onSubmitted(updated);
    } catch (e) {
      if (e instanceof ApiError && e.violations.length > 0) setViolations(e.violations);
      else if (e instanceof ApiError && e.isStale) setSubmitError('This task changed elsewhere. Reload to continue.');
      else setSubmitError(e instanceof Error ? e.message : 'Submit failed');
    } finally {
      setSubmitting(false);
    }
  }

  useShortcuts([
    { key: 'z', ctrl: true, handler: undo }, // inside text fields the browser's own undo applies
    { key: 's', ctrl: true, allowWhileTyping: true, handler: () => { void autosave.saveNow(); } },
    { key: 'Enter', ctrl: true, allowWhileTyping: true, handler: () => { void handleSubmit(); } },
    { key: '?', handler: () => setShowHelp((v) => !v) },
  ], task.canEdit);

  const save = SAVE_STYLE[autosave.state];
  const isAudio = task.taskType === 'TRANSCRIPTION';

  return (
    <Stack component="section" aria-labelledby="task-title" spacing={2}>
      <Box>
        <Stack direction="row" spacing={1.5} alignItems="center">
          <Avatar variant="rounded" sx={{
            width: 44, height: 44, borderRadius: 3, color: '#fff',
            background: isAudio ? 'linear-gradient(135deg,#6366f1,#3b82f6)' : 'linear-gradient(135deg,#0ea5a0,#10b981)',
          }}>
            {isAudio ? <GraphicEqIcon /> : <NotesIcon />}
          </Avatar>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h1" id="task-title" noWrap>{task.title}</Typography>
            <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
              {taskTypeLabel(task.taskType)} · schema v{task.schemaVersion} · {task.id}
            </Typography>
          </Box>
        </Stack>
      </Box>

      {/* context strip */}
      <Card sx={{ px: 2.5, py: 1.5 }}>
        <Stack direction="row" spacing={{ xs: 2, md: 4 }} flexWrap="wrap" useFlexGap alignItems="center">
          <Meta label="Status"><StatusBadge status={task.status} /></Meta>
          <Meta label="Labeler">
            <Avatar sx={{ width: 24, height: 24, fontSize: 11, bgcolor: avatarColor(task.assigneeName ?? '?') }}>
              {initials(task.assigneeName ?? '?')}
            </Avatar>
            {task.assigneeName ?? 'unassigned'}
          </Meta>
          <Meta label="Your role">
            <Chip size="small" label={task.viewerRole.toLowerCase()} color={task.viewerRole === 'REVIEWER' ? 'primary' : 'secondary'} variant="outlined" sx={{ fontWeight: 650 }} />
          </Meta>
          <Box sx={{ flex: 1 }} />
          {task.canEdit && (
            <Stack direction="row" spacing={0.75} alignItems="center" sx={{ color: save.color }}>
              {save.icon}
              <Typography role="status" aria-live="polite" sx={{ fontSize: 13.5, fontWeight: 650 }}>
                {SAVE_LABEL[autosave.state]}
              </Typography>
            </Stack>
          )}
        </Stack>
      </Card>

      {task.status === 'CHANGES_REQUESTED' && task.lastReview?.comment && (
        <Alert severity="warning" role="note" variant="outlined">
          <AlertTitle sx={{ fontWeight: 700 }}>{task.lastReview.reviewerName} requested changes</AlertTitle>
          {task.lastReview.comment}
        </Alert>
      )}
      {!task.canEdit && (
        <Alert severity="info" role="note" variant="outlined">
          Read-only: {task.status === 'IN_PROGRESS' || task.status === 'CHANGES_REQUESTED'
            ? 'only the assignee can edit this task.'
            : 'this task has been submitted and can no longer be edited by the annotator.'}
        </Alert>
      )}
      {autosave.state === 'conflict' && (
        <Alert severity="error" role="alert">
          This task was changed elsewhere (another tab, or a reviewer acted). Your latest edits were NOT saved.
          <Stack direction="row" spacing={1} sx={{ mt: 1.5 }} flexWrap="wrap" useFlexGap>
            <Button variant="contained" color="error" size="small" onClick={onReload}>Reload latest (discards my unsaved edits)</Button>
            <Button variant="outlined" color="error" size="small"
              onClick={() => { void navigator.clipboard?.writeText(JSON.stringify(value, null, 2)); }}>
              Copy my edits
            </Button>
          </Stack>
        </Alert>
      )}
      {autosave.state === 'error' && (
        <Alert severity="error" role="alert"
          action={<Button color="inherit" size="small" onClick={() => { void autosave.saveNow(); }}>Retry save</Button>}>
          Could not save: {autosave.error}
        </Alert>
      )}

      <TaskEditor
        taskType={task.taskType}
        schemaVersion={task.schemaVersion}
        payload={value}
        input={task.input}
        readOnly={!task.canEdit}
        onChange={set}
        errors={violations}
        draft={task.draft ?? null}
      />

      {violations.length > 0 && (
        <Alert severity="error" role="alert">
          <AlertTitle sx={{ fontWeight: 700 }}>Fix these before submitting:</AlertTitle>
          <Box component="ul" sx={{ m: 0, pl: 2.5 }}>{violations.map((v) => <li key={v}>{v}</li>)}</Box>
        </Alert>
      )}
      {submitError && <Alert severity="error" role="alert">{submitError}</Alert>}

      {task.canEdit && (
        <Card sx={{
          position: 'sticky', bottom: 12, zIndex: 2, px: { xs: 1, sm: 2 }, py: 1.25,
          boxShadow: '0 10px 30px rgba(15,23,42,.12)', backdropFilter: 'blur(8px)',
          bgcolor: 'color-mix(in srgb, var(--mui-palette-background-paper) 90%, transparent)',
        }}>
          <Stack direction="row" spacing={{ xs: 0.25, sm: 1 }} alignItems="center"
            sx={{ '& .tool': { minWidth: 0, px: { xs: 1, sm: 1.5 } }, '& .tool .MuiButton-startIcon': { mr: { xs: 0, sm: 1 } } }}>
            <Tooltip title="Undo (Ctrl+Z)"><span>
              <Button className="tool" aria-label="Undo" startIcon={<UndoIcon />} onClick={undo} disabled={!canUndo} color="inherit">
                <Box component="span" sx={toolLabel}>Undo</Box>
              </Button>
            </span></Tooltip>
            <Tooltip title="Save now (Ctrl+S)">
              <Button className="tool" aria-label="Save now" startIcon={<SaveIcon />} onClick={() => { void autosave.saveNow(); }} color="inherit">
                <Box component="span" sx={toolLabel}>Save now</Box>
              </Button>
            </Tooltip>
            <Tooltip title="Keyboard shortcuts (?)">
              <Button className="tool" aria-label="Shortcuts" startIcon={<KeyboardIcon />} onClick={() => setShowHelp((v) => !v)}
                aria-expanded={showHelp} color="inherit">
                <Box component="span" sx={toolLabel}>Shortcuts (?)</Box>
              </Button>
            </Tooltip>
            <Box sx={{ flex: 1 }} />
            <Button variant="contained" size="large" endIcon={<SendIcon />} disabled={submitting}
              onClick={() => { void handleSubmit(); }}
              sx={{ borderRadius: 99, px: { xs: 2, sm: 3 }, whiteSpace: 'nowrap', background: 'linear-gradient(135deg, var(--mui-palette-primary-main), #6d5ef6)' }}>
              {submitting ? 'Submitting…' : 'Submit for review'}
              <Box component="span" sx={{ ml: 1, fontSize: 11.5, opacity: 0.75, display: { xs: 'none', sm: 'inline' } }}>Ctrl+↵</Box>
            </Button>
          </Stack>
          <Collapse in={showHelp} unmountOnExit>
            <Box component="dl" aria-label="Keyboard shortcuts" sx={{
              display: 'grid', gridTemplateColumns: { xs: 'max-content 1fr', md: 'repeat(3, max-content 1fr)' },
              gap: '6px 14px', m: 0, mt: 1.5, pt: 1.5, borderTop: 1, borderColor: 'divider', fontSize: 13,
            }}>
              {SHORTCUTS.map(([k, v]) => (
                <Box key={k} sx={{ display: 'contents' }}>
                  <Box component="dt"><Box component="kbd" sx={{
                    px: 0.75, py: 0.1, borderRadius: 1, border: 1, borderColor: 'divider', bgcolor: 'action.hover',
                    fontFamily: 'ui-monospace, monospace', fontSize: 12, fontWeight: 700,
                  }}>{k}</Box></Box>
                  <Box component="dd" sx={{ m: 0, color: 'text.secondary' }}>{v}</Box>
                </Box>
              ))}
            </Box>
          </Collapse>
        </Card>
      )}
    </Stack>
  );
}
