import type { ReactNode } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link as RouterLink, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Alert, Avatar, Badge, Box, Button, Card, Chip, InputAdornment, Skeleton, Stack, Tab, Table, TableBody,
  TableCell, TableContainer, TableHead, TablePagination, TableRow, Tabs, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import GraphicEqIcon from '@mui/icons-material/GraphicEq';
import NotesIcon from '@mui/icons-material/Notes';
import InboxIcon from '@mui/icons-material/Inbox';
import PendingActionsIcon from '@mui/icons-material/PendingActions';
import RateReviewIcon from '@mui/icons-material/RateReview';
import TaskAltIcon from '@mui/icons-material/TaskAlt';
import BoltIcon from '@mui/icons-material/Bolt';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import { api } from '../../shared/api';
import { useAuth } from '../../shared/auth';
import { STATUS_META, StatusBadge } from '../../shared/StatusBadge';
import type { TaskStatus, TaskSummary } from '../../shared/types';
import { PAGE_SIZES } from '../../shared/usePagination';
import { useActiveProject } from '../../shared/useActiveProject';
import { useThroughput } from '../../shared/useThroughput';
import { avatarColor, initials, relativeTime } from '../../shared/format';
import { taskTypeLabel } from '../../task-editors/registry-data';
import { StatCard } from '../../shared/StatCard';
import { AdminHome } from '../admin/AdminHome';

const STATUSES: TaskStatus[] = ['IN_PROGRESS', 'SUBMITTED', 'CHANGES_REQUESTED', 'APPROVED'];
const TYPE_ICON: Record<string, ReactNode> = {
  TRANSCRIPTION: <GraphicEqIcon fontSize="small" />,
  CALL_SCORECARD: <NotesIcon fontSize="small" />,
};
const TYPE_COLOR: Record<string, string> = { TRANSCRIPTION: '#6366f1', CALL_SCORECARD: '#0ea5a0' };

function TaskTypeCell({ task }: { task: TaskSummary }) {
  const color = TYPE_COLOR[task.taskType] ?? '#64748b';
  return (
    <Stack direction="row" spacing={1.5} alignItems="center">
      <Avatar variant="rounded" sx={{ width: 36, height: 36, borderRadius: 2.5, bgcolor: `${color}1f`, color }}>
        {TYPE_ICON[task.taskType] ?? <NotesIcon fontSize="small" />}
      </Avatar>
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontWeight: 650, fontSize: 14.5 }}>{task.title}</Typography>
        <Typography sx={{ fontSize: 12, color: 'text.secondary', fontFamily: 'ui-monospace, monospace' }}>{task.id}</Typography>
      </Box>
    </Stack>
  );
}

export function QueuePage() {
  const { projects, active } = useActiveProject();
  const { isAdmin, isOperator } = useAuth();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const notice = (useLocation().state as { notice?: string } | null)?.notice;
  const throughput = useThroughput();
  const status = (params.get('status') ?? '') as TaskStatus | '';
  const type = params.get('type') ?? '';
  const q = params.get('q') ?? '';
  const page = Math.max(0, Number(params.get('page') ?? '1') - 1); // 1-based in the address bar
  const size = PAGE_SIZES.includes(Number(params.get('size'))) ? Number(params.get('size')) : 25;

  // Any filter change goes back to the first page.
  const setParam = (key: string, value: string) => setParams((p) => {
    if (value) p.set(key, value); else p.delete(key);
    if (key !== 'page') p.delete('page');
    return p;
  }, { replace: true });

  // The server filters, sorts (most recently modified first) and pages; it also returns whole-project counts.
  const tasks = useQuery({
    queryKey: ['tasks', active?.id, status, type, q, page, size],
    queryFn: () => api.listTasks(active!.id, { status: status || undefined, type: type || undefined, q: q || undefined, page, size }),
    enabled: !!active,
    placeholderData: keepPreviousData,
  });

  const rows = tasks.data?.items ?? [];
  const counts: Partial<Record<TaskStatus, number>> = tasks.data?.counts ?? {};
  const types = tasks.data?.types ?? [];
  const matching = tasks.data?.total ?? 0;

  if (projects.isLoading) return <Skeleton variant="rounded" height={320} />;
  if (projects.error) return <Alert severity="error" role="alert">Could not load projects. Is the API running?</Alert>;
  if (!active) {
    if (isAdmin && !isOperator) return <AdminHome />;
    return (
      <Alert severity="info" role="note"
        action={isOperator
          ? <Button component={RouterLink} to="/platform" color="inherit">Open platform</Button> : undefined}>
        {isOperator
          ? 'The platform operator belongs to no organisation and sees no customer tasks.'
          : 'You are not a member of any project yet. Ask an administrator to add you.'}
      </Alert>
    );
  }

  const isReviewer = active.role === 'REVIEWER';
  const total = tasks.data?.projectTotal ?? 0;

  return (
    <Stack component="section" aria-labelledby="queue-title" spacing={3}>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'flex-end' }} spacing={2}>
        <Box>
          <Typography variant="overline" color="secondary.main">{active.name}</Typography>
          <Typography variant="h1" id="queue-title">{status === 'SUBMITTED' ? 'Review queue' : 'Task queue'}</Typography>
          <Typography sx={{ color: 'text.secondary', mt: 0.5 }}>
            You are <Box component="strong" sx={{ color: 'text.primary' }}>{active.role.toLowerCase()}</Box> on this project.
            {isReviewer ? ' Submitted tasks are waiting for your decision.' : ' Pick up a task and annotate it.'}
          </Typography>
        </Box>
        <Tooltip title="Based on submissions in this browser session">
          <Chip icon={<BoltIcon />} variant="outlined" color="secondary"
            label={`Session: ${throughput.submitted} submitted${throughput.perHour !== null ? ` · ${throughput.perHour}/hour` : ''}`}
            sx={{ fontWeight: 600, alignSelf: { xs: 'flex-start', sm: 'auto' } }} />
        </Tooltip>
      </Stack>

      {notice && <Alert severity="success" role="status" variant="outlined">{notice}</Alert>}

      <Stack direction="row" flexWrap="wrap" useFlexGap spacing={2}>
        <StatCard icon={<InboxIcon />} label="All tasks" value={total} color="#6366f1" hint={`${types.length} task type${types.length === 1 ? '' : 's'}`} />
        <StatCard icon={<PendingActionsIcon />} label="In progress" value={counts.IN_PROGRESS ?? 0} total={total} color={STATUS_META.IN_PROGRESS.color} />
        <StatCard icon={<RateReviewIcon />} label="Awaiting review" value={counts.SUBMITTED ?? 0} total={total} color={STATUS_META.SUBMITTED.color} />
        <StatCard icon={<TaskAltIcon />} label="Approved" value={counts.APPROVED ?? 0} total={total} color={STATUS_META.APPROVED.color} />
      </Stack>

      <Card sx={{ overflow: 'hidden' }}>
        <Box sx={{ px: 2, pt: 1, borderBottom: 1, borderColor: 'divider' }}>
          <Tabs value={status || 'ALL'} onChange={(_, v: string) => setParam('status', v === 'ALL' ? '' : v)}
            variant="scrollable" allowScrollButtonsMobile aria-label="Filter by status">
            {(['ALL', ...STATUSES] as const).map((s) => (
              <Tab key={s} value={s} sx={{ minHeight: 52 }} label={
                <Stack direction="row" spacing={1} alignItems="center">
                  <span>{s === 'ALL' ? 'All' : STATUS_META[s].label}</span>
                  <Badge badgeContent={s === 'ALL' ? total : counts[s] ?? 0} showZero max={999}
                    sx={{ '& .MuiBadge-badge': {
                      position: 'static', transform: 'none', fontSize: 11, fontWeight: 700, minWidth: 22, height: 20,
                      bgcolor: s === 'ALL' ? 'action.selected' : `${STATUS_META[s].color}22`,
                      color: s === 'ALL' ? 'text.primary' : STATUS_META[s].color,
                    } }} />
                </Stack>
              } />
            ))}
          </Tabs>
        </Box>

        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ p: 2 }} alignItems={{ md: 'center' }}>
          <TextField size="small" placeholder="Search tasks…" value={q} onChange={(e) => setParam('q', e.target.value)}
            inputProps={{ 'aria-label': 'Search tasks' }} sx={{ flex: 1, maxWidth: { md: 360 } }}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }} />
          <ToggleButtonGroup size="small" exclusive value={type} aria-label="Filter by task type"
            onChange={(_, v: string | null) => setParam('type', v ?? '')}>
            <ToggleButton value="" sx={{ px: 2 }}>All types</ToggleButton>
            {types.map((t) => (
              <ToggleButton key={t} value={t} sx={{ px: 2, gap: 0.75 }}>{TYPE_ICON[t]}{taskTypeLabel(t)}</ToggleButton>
            ))}
          </ToggleButtonGroup>
          <Box sx={{ flex: 1 }} />
          <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
            {matching === total ? <>Showing <b>{rows.length}</b> of {total}</> : <><b>{matching}</b> of {total} match</>}
            {' · newest changes first'}
          </Typography>
        </Stack>

        {tasks.isLoading && <Box sx={{ p: 2 }}><Skeleton height={48} /><Skeleton height={48} /><Skeleton height={48} /></Box>}
        {tasks.error && <Alert severity="error" role="alert" sx={{ m: 2 }}>Could not load tasks.</Alert>}
        {tasks.data && rows.length === 0 && (
          <Stack alignItems="center" spacing={1} sx={{ py: 6, color: 'text.secondary' }}>
            <InboxIcon sx={{ fontSize: 40, opacity: 0.5 }} />
            <Typography>No tasks match these filters.</Typography>
          </Stack>
        )}
        {rows.length > 0 && (
          <TableContainer>
            <Table sx={{ minWidth: 760 }}>
              <TableHead>
                <TableRow sx={{ bgcolor: 'action.hover' }}>
                  <TableCell width={48}>#</TableCell>
                  <TableCell>Task</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Assignee</TableCell>
                  <TableCell>Updated</TableCell>
                  <TableCell align="right" />
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((t, i) => {
                  const review = isReviewer && t.status === 'SUBMITTED';
                  return (
                    <TableRow key={t.id} hover onClick={() => navigate(`/tasks/${t.id}`)}
                      sx={{ cursor: 'pointer', '&:last-child td': { border: 0 } }}>
                      <TableCell sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>{page * size + i + 1}</TableCell>
                      <TableCell><TaskTypeCell task={t} /></TableCell>
                      <TableCell>
                        <Chip size="small" variant="outlined" label={taskTypeLabel(t.taskType)}
                          sx={{ fontWeight: 600, color: TYPE_COLOR[t.taskType], borderColor: `${TYPE_COLOR[t.taskType]}55` }} />
                      </TableCell>
                      <TableCell><StatusBadge status={t.status} /></TableCell>
                      <TableCell>
                        {t.assigneeName ? (
                          <Stack direction="row" spacing={1} alignItems="center">
                            <Avatar sx={{ width: 26, height: 26, fontSize: 11, bgcolor: avatarColor(t.assigneeName) }}>{initials(t.assigneeName)}</Avatar>
                            <Typography sx={{ fontSize: 14 }}>{t.assigneeName}</Typography>
                          </Stack>
                        ) : '—'}
                      </TableCell>
                      <TableCell sx={{ color: 'text.secondary', fontSize: 13, whiteSpace: 'nowrap' }}>
                        <Tooltip title={new Date(t.updatedAt).toLocaleString()}><span>{relativeTime(t.updatedAt)}</span></Tooltip>
                      </TableCell>
                      <TableCell align="right">
                        <Button component={RouterLink} to={`/tasks/${t.id}`} size="small" onClick={(e) => e.stopPropagation()}
                          variant={review ? 'contained' : 'outlined'} endIcon={<ArrowForwardIcon />} sx={{ borderRadius: 99 }}>
                          {review ? 'Review' : 'Open'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
        {matching > PAGE_SIZES[0] && (
          <TablePagination component="div" count={matching} page={Math.min(page, Math.max(0, Math.ceil(matching / size) - 1))}
            rowsPerPage={size} rowsPerPageOptions={PAGE_SIZES} labelRowsPerPage="Tasks per page" aria-label="Task pages"
            onPageChange={(_, p) => setParam('page', p === 0 ? '' : String(p + 1))}
            onRowsPerPageChange={(e) => setParams((p) => { p.set('size', e.target.value); p.delete('page'); return p; }, { replace: true })}
            sx={{ borderTop: 1, borderColor: 'divider' }} />
        )}
      </Card>
    </Stack>
  );
}
