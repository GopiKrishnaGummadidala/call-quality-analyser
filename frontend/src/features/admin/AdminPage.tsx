import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert, Avatar, Box, Button, Card, Chip, IconButton, Skeleton, Snackbar,
  Stack, Tooltip, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography,
} from '@mui/material';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettingsOutlined';
import DnsIcon from '@mui/icons-material/DnsOutlined';
import CheckIcon from '@mui/icons-material/Check';
import RemoveIcon from '@mui/icons-material/Remove';
import GroupIcon from '@mui/icons-material/GroupOutlined';
import VisibilityIcon from '@mui/icons-material/VisibilityOutlined';
import HeadphonesIcon from '@mui/icons-material/HeadphonesOutlined';
import PersonAddIcon from '@mui/icons-material/PersonAddAlt1';
import EditIcon from '@mui/icons-material/EditOutlined';
import HistoryIcon from '@mui/icons-material/History';
import { visuallyHidden } from '@mui/utils';
import { UserDialog } from './UserDialog';
import { usePagination } from '../../shared/usePagination';
import { api } from '../../shared/api';
import { useAuth } from '../../shared/auth';
import { avatarColor, initials, relativeTime } from '../../shared/format';
import type { AccessLogEntry, AccountEvent, AdminUser } from '../../shared/types';

const ROLE_COLOR = { OPERATOR: '#64748b', ADMIN: '#ef4444', REVIEWER: '#6366f1', ANNOTATOR: '#0ea5a0' } as const;

/** What each role may do. Mirrors the server-side checks (AccessService, TaskService, @PreAuthorize). */
const PERMISSIONS: [string, boolean, boolean, boolean, boolean][] = [
  ['See tasks of projects they belong to', true, true, false, false],
  ['Annotate, autosave and submit their own tasks', true, false, false, false],
  ['Approve or request changes on submitted tasks', false, true, false, false],
  ['View model evaluation of their projects', true, true, false, false],
  ['Add and edit accounts, roles and memberships; see the access log', false, false, true, false],
  ['Release and export de-identified training data', false, false, true, false],
  ['See tenant sizes (counts only) and reset the demo', false, false, false, true],
];

function RoleChip({ role }: { role: keyof typeof ROLE_COLOR }) {
  const c = ROLE_COLOR[role];
  return <Chip size="small" label={role.toLowerCase()} sx={{ fontWeight: 650, color: c, bgcolor: `${c}1a`, border: `1px solid ${c}55` }} />;
}

const EVENT_LABEL: Record<AccountEvent['action'], string> = {
  USER_CREATED: 'added', USER_UPDATED: 'changed', PASSWORD_RESET: 'reset the password of',
};

/** "account role user → admin, project roles" — which fields changed, never values that could be secrets. */
function eventSummary(e: AccountEvent): string {
  if (e.action === 'PASSWORD_RESET') return 'Signed out of every session';
  if (e.action === 'USER_CREATED') {
    const m = (e.details.memberships as { role: string }[] | undefined) ?? [];
    return `${String(e.details.globalRole ?? 'USER').toLowerCase()} account${m.length ? `, ${m.length} project role${m.length === 1 ? '' : 's'}` : ''}`;
  }
  const parts: string[] = [];
  const role = e.details.globalRole as { from: string; to: string } | undefined;
  if (e.details.displayName) parts.push('name');
  if (role) parts.push(`account role ${role.from.toLowerCase()} → ${role.to.toLowerCase()}`);
  if (e.details.memberships) parts.push('project roles');
  return parts.join(', ');
}

function Yes({ on }: { on: boolean }) {
  return on
    ? <CheckIcon aria-label="allowed" sx={{ color: 'success.main' }} fontSize="small" />
    : <RemoveIcon aria-label="not allowed" sx={{ color: 'text.disabled' }} fontSize="small" />;
}

export function AdminPage() {
  const { user } = useAuth();
  const users = useQuery({ queryKey: ['adminUsers'], queryFn: api.adminUsers });
  const events = useQuery({ queryKey: ['accountEvents'], queryFn: api.accountEvents });
  const [dialog, setDialog] = useState<{ user?: AdminUser } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const accountPages = usePagination(users.data ?? [], 'Accounts');
  const eventPages = usePagination(events.data ?? [], 'Account changes');
  const accessLog = useQuery({ queryKey: ['accessLog'], queryFn: () => api.accessLog(100), refetchInterval: 15_000 });
  const accessPages = usePagination(accessLog.data ?? [], 'Access log');

  return (
    <Stack component="section" aria-labelledby="admin-title" spacing={3}>
      <Box>
        <Typography variant="overline" color="secondary.main">{user?.tenantName}</Typography>
        <Stack direction="row" spacing={1.25} alignItems="center">
          <AdminPanelSettingsIcon color="error" />
          <Typography variant="h1" id="admin-title">Administration</Typography>
        </Stack>
        <Typography sx={{ color: 'text.secondary', mt: 0.5 }}>
          Add and edit accounts, give people project roles, and see who accessed customer data. Admins do not annotate or review themselves.
        </Typography>
      </Box>


      <Card sx={{ overflow: 'hidden' }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 2.5, py: 2, borderBottom: 1, borderColor: 'divider' }}>
          <GroupIcon sx={{ color: 'text.secondary' }} />
          <Typography variant="h2">Accounts</Typography>
          <Chip size="small" label={users.data?.length ?? '…'} />
          <Box sx={{ flexGrow: 1 }} />
          <Button variant="contained" startIcon={<PersonAddIcon />} onClick={() => setDialog({})}>Add user</Button>
        </Stack>
        {users.isLoading && <Box sx={{ p: 2 }}><Skeleton height={44} /><Skeleton height={44} /></Box>}
        {users.error && <Alert severity="error" role="alert" sx={{ m: 2 }}>Could not load accounts.</Alert>}
        {users.data && (
          <TableContainer>
            <Table sx={{ minWidth: 640 }}>
              <TableHead>
                <TableRow sx={{ bgcolor: 'action.hover' }}>
                  <TableCell>User</TableCell><TableCell>Username</TableCell><TableCell>Account role</TableCell><TableCell>Project roles</TableCell><TableCell align="right"><Box component="span" sx={visuallyHidden}>Actions</Box></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {accountPages.pageRows.map((u) => (
                  <TableRow key={u.id} sx={{ '&:last-child td': { border: 0 } }}>
                    <TableCell>
                      <Stack direction="row" spacing={1.25} alignItems="center">
                        <Avatar sx={{ width: 30, height: 30, fontSize: 12, bgcolor: avatarColor(u.displayName) }}>{initials(u.displayName)}</Avatar>
                        <Typography sx={{ fontWeight: 600, fontSize: 14 }}>{u.displayName}</Typography>
                        {u.id === user?.id && <Chip size="small" label="you" variant="outlined" sx={{ height: 20, fontSize: 11 }} />}
                      </Stack>
                    </TableCell>
                    <TableCell sx={{ fontFamily: 'ui-monospace, monospace', fontSize: 13 }}>@{u.username}</TableCell>
                    <TableCell>{u.globalRole === 'ADMIN' ? <RoleChip role="ADMIN" /> : <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>user</Typography>}</TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                        {u.memberships.length === 0 && <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>—</Typography>}
                        {u.memberships.map((m) => (
                          <Stack key={m.projectId} direction="row" spacing={0.75} alignItems="center">
                            <Typography sx={{ fontSize: 13 }}>{m.projectName}</Typography>
                            <RoleChip role={m.role} />
                          </Stack>
                        ))}
                      </Stack>
                    </TableCell>
                    <TableCell align="right">
                      <Tooltip title="Edit user">
                        <IconButton aria-label={`Edit ${u.displayName}`} onClick={() => setDialog({ user: u })}><EditIcon fontSize="small" /></IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
        {accountPages.pager}
      </Card>

      <Card component="section" aria-labelledby="account-events-title" sx={{ overflow: 'hidden' }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 2.5, py: 2, borderBottom: 1, borderColor: 'divider' }}>
          <HistoryIcon sx={{ color: 'text.secondary' }} />
          <Typography variant="h2" id="account-events-title">Account changes</Typography>
          <Typography sx={{ fontSize: 13, color: 'text.secondary', display: { xs: 'none', sm: 'block' } }}>
            · who added or changed which account (passwords are never recorded)
          </Typography>
        </Stack>
        {events.error && <Alert severity="error" role="alert" sx={{ m: 2 }}>Could not load account changes.</Alert>}
        {events.data && events.data.length === 0 && (
          <Typography sx={{ p: 2.5, color: 'text.secondary', fontSize: 14 }}>No account has been added or changed yet.</Typography>
        )}
        {events.data && events.data.length > 0 && (
          <TableContainer sx={{ maxHeight: 280 }}>
            <Table size="small" stickyHeader aria-label="Account changes" sx={{ minWidth: 560 }}>
              <TableHead>
                <TableRow><TableCell>When</TableCell><TableCell>Change</TableCell><TableCell>Details</TableCell></TableRow>
              </TableHead>
              <TableBody>
                {eventPages.pageRows.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell sx={{ whiteSpace: 'nowrap', fontSize: 13, color: 'text.secondary' }} title={new Date(e.createdAt).toLocaleString()}>
                      {relativeTime(e.createdAt)}
                    </TableCell>
                    <TableCell sx={{ fontSize: 13.5 }}>{e.actorName} {EVENT_LABEL[e.action]} <b>{e.targetName}</b></TableCell>
                    <TableCell sx={{ fontSize: 13, color: 'text.secondary' }}>{eventSummary(e)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
        {eventPages.pager}
      </Card>

      {dialog && (
        <UserDialog user={dialog.user} isSelf={dialog.user?.id === user?.id} onClose={() => setDialog(null)}
          onSaved={(message) => { setDialog(null); setNotice(message); }} />
      )}
      <Snackbar open={!!notice} autoHideDuration={4000} onClose={() => setNotice(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity="success" variant="filled" role="status" onClose={() => setNotice(null)}>{notice}</Alert>
      </Snackbar>

      <Card component="section" aria-labelledby="access-log-title" sx={{ overflow: 'hidden' }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 2.5, py: 2, borderBottom: 1, borderColor: 'divider' }}>
          <VisibilityIcon sx={{ color: 'text.secondary' }} />
          <Typography variant="h2" id="access-log-title">Access log</Typography>
          <Typography sx={{ fontSize: 13, color: 'text.secondary', display: { xs: 'none', sm: 'block' } }}>
            · who opened which task or recording, including denied attempts (latest 100)
          </Typography>
        </Stack>
        {accessLog.isLoading && <Box sx={{ p: 2 }}><Skeleton height={36} /><Skeleton height={36} /></Box>}
        {accessLog.error && <Alert severity="error" role="alert" sx={{ m: 2 }}>Could not load the access log.</Alert>}
        {accessLog.data && accessLog.data.length === 0 && (
          <Typography sx={{ p: 2.5, color: 'text.secondary', fontSize: 14 }}>No task has been opened yet.</Typography>
        )}
        {accessLog.data && accessLog.data.length > 0 && (
          <TableContainer sx={{ maxHeight: 360 }}>
            <Table size="small" stickyHeader aria-label="Access log" sx={{ minWidth: 640 }}>
              <TableHead>
                <TableRow>
                  <TableCell>When</TableCell><TableCell>Who</TableCell><TableCell>What</TableCell><TableCell>Task</TableCell><TableCell>Result</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {accessPages.pageRows.map((e: AccessLogEntry) => (
                  <TableRow key={e.id}>
                    <TableCell sx={{ whiteSpace: 'nowrap', fontSize: 13, color: 'text.secondary' }} title={new Date(e.createdAt).toLocaleString()}>
                      {relativeTime(e.createdAt)}
                    </TableCell>
                    <TableCell sx={{ fontSize: 13.5, fontStyle: e.sameOrganisation ? 'normal' : 'italic' }}>{e.actorName}</TableCell>
                    <TableCell sx={{ fontSize: 13.5 }}>
                      <Stack direction="row" spacing={0.75} alignItems="center">
                        {e.action === 'READ_AUDIO' ? <HeadphonesIcon sx={{ fontSize: 16 }} /> : <VisibilityIcon sx={{ fontSize: 16 }} />}
                        <span>{e.action === 'READ_AUDIO' ? 'played recording' : 'viewed task'}</span>
                      </Stack>
                    </TableCell>
                    <TableCell sx={{ fontSize: 13.5 }}>{e.taskTitle}</TableCell>
                    <TableCell>
                      <Chip size="small" label={e.outcome === 'ALLOWED' ? 'allowed' : 'denied'}
                        color={e.outcome === 'ALLOWED' ? 'success' : 'error'} variant="outlined" sx={{ fontWeight: 650 }} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
        {accessPages.pager}
      </Card>

      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', lg: '2fr 1fr' }, alignItems: 'start' }}>
        <Card sx={{ overflow: 'hidden' }}>
          <Typography variant="h2" sx={{ px: 2.5, py: 2, borderBottom: 1, borderColor: 'divider' }}>Roles and permissions</Typography>
          <TableContainer>
            <Table size="small" sx={{ minWidth: 520 }}>
              <TableHead>
                <TableRow sx={{ bgcolor: 'action.hover' }}>
                  <TableCell>Permission</TableCell>
                  <TableCell align="center"><RoleChip role="ANNOTATOR" /></TableCell>
                  <TableCell align="center"><RoleChip role="REVIEWER" /></TableCell>
                  <TableCell align="center"><RoleChip role="ADMIN" /></TableCell>
                  <TableCell align="center"><RoleChip role="OPERATOR" /></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {PERMISSIONS.map(([label, a, r, ad, op]) => (
                  <TableRow key={label}>
                    <TableCell sx={{ fontSize: 13.5 }}>{label}</TableCell>
                    <TableCell align="center"><Yes on={a} /></TableCell>
                    <TableCell align="center"><Yes on={r} /></TableCell>
                    <TableCell align="center"><Yes on={ad} /></TableCell>
                    <TableCell align="center"><Yes on={op} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <Typography sx={{ px: 2.5, py: 1.5, fontSize: 12.5, color: 'text.secondary' }}>
            Annotator and reviewer are per-project roles; admin and operator are account roles. Reviewers cannot review
            their own work, nobody can see projects outside their organisation, and the platform operator belongs to none.
          </Typography>
        </Card>

        <Card sx={{ p: 2.5 }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <DnsIcon sx={{ color: 'text.secondary' }} />
            <Typography variant="h2">Demo data</Typography>
          </Stack>
          <Typography sx={{ fontSize: 13.5, color: 'text.secondary', mt: 1 }}>
            A demo reset re-seeds every organisation, so it is a platform operation: the <b>ops</b> account runs it from
            the Platform page. Organisation admins cannot affect other organisations.
          </Typography>
        </Card>
      </Box>

    </Stack>
  );
}
