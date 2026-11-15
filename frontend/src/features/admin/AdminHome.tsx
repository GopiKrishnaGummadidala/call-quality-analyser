import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert, Avatar, Box, Button, Card, Chip, List, ListItem, ListItemAvatar, ListItemText, Skeleton, Stack, Typography,
} from '@mui/material';
import GroupIcon from '@mui/icons-material/Group';
import FolderIcon from '@mui/icons-material/Folder';
import TaskAltIcon from '@mui/icons-material/TaskAlt';
import Inventory2Icon from '@mui/icons-material/Inventory2';
import ManageAccountsIcon from '@mui/icons-material/ManageAccounts';
import ShieldIcon from '@mui/icons-material/Shield';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import { api } from '../../shared/api';
import { useAuth } from '../../shared/auth';
import { clock, relativeTime } from '../../shared/format';
import { StatCard } from '../../shared/StatCard';

function ActionCard({ icon, color, title, text, to, cta }: {
  icon: ReactNode; color: string; title: string; text: string; to: string; cta: string;
}) {
  return (
    <Card sx={{ p: 2.5, flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      <Avatar variant="rounded" sx={{ bgcolor: `${color}1f`, color, width: 44, height: 44, borderRadius: 2.5 }}>{icon}</Avatar>
      <Typography variant="h3" sx={{ fontSize: 17, fontWeight: 700 }}>{title}</Typography>
      <Typography sx={{ color: 'text.secondary', fontSize: 14, flexGrow: 1 }}>{text}</Typography>
      <Box><Button component={RouterLink} to={to} endIcon={<ArrowForwardIcon />}>{cta}</Button></Box>
    </Card>
  );
}

/** Landing page for an administrator who annotates on no project: what their organisation looks like and where to go. */
export function AdminHome() {
  const { user } = useAuth();
  const users = useQuery({ queryKey: ['adminUsers'], queryFn: api.adminUsers });
  const projects = useQuery({ queryKey: ['data-projects'], queryFn: api.dataProjects });
  const access = useQuery({ queryKey: ['access-log', 5], queryFn: () => api.accessLog(5) });

  const approved = (projects.data ?? []).reduce((n, p) => n + p.approvedTasks, 0);
  const releases = (projects.data ?? []).reduce((n, p) => n + p.releases, 0);
  const loading = users.isLoading || projects.isLoading;

  return (
    <Stack component="section" aria-labelledby="admin-home-title" spacing={3}>
      <Box>
        <Typography variant="overline" color="secondary.main">{user?.tenantName}</Typography>
        <Typography variant="h1" id="admin-home-title">Welcome, {user?.displayName}</Typography>
        <Typography sx={{ color: 'text.secondary', mt: 0.5 }}>
          You administer this organisation. You are not on any annotation project, so you have no task queue;
          here is how your organisation is doing.
        </Typography>
      </Box>

      {users.error || projects.error
        ? <Alert severity="error" role="alert">Could not load the organisation overview.</Alert>
        : loading ? <Skeleton variant="rounded" height={110} />
        : (
          <Stack direction="row" flexWrap="wrap" useFlexGap spacing={2} aria-label="Organisation overview">
            <StatCard icon={<GroupIcon />} label="Users" value={users.data!.length} color="#6366f1"
              hint={`${users.data!.filter((u) => u.memberships.length > 0).length} on a project`} />
            <StatCard icon={<FolderIcon />} label="Projects" value={projects.data!.length} color="#0ea5a0" hint="In this organisation" />
            <StatCard icon={<TaskAltIcon />} label="Approved tasks" value={approved} color="#16a34a" hint="Ready for training data" />
            <StatCard icon={<Inventory2Icon />} label="Training releases" value={releases} color="#f59e0b" hint="De-identified, immutable" />
          </Stack>
        )}

      <Stack direction="row" flexWrap="wrap" useFlexGap spacing={2}>
        <ActionCard icon={<ManageAccountsIcon />} color="#6366f1" title="Users and roles"
          text="Add and edit accounts, give people project roles as annotator or reviewer, and see the access log."
          to="/admin" cta="Open administration" />
        <ActionCard icon={<Inventory2Icon />} color="#f59e0b" title="Training-data releases"
          text="Turn approved transcripts into a versioned, de-identified dataset with a signed manifest."
          to="/admin/datasets" cta="Open releases" />
      </Stack>

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="stretch">
        <Card sx={{ p: 2.5, flex: 1 }}>
          <Typography variant="h3" sx={{ fontSize: 16, fontWeight: 700, mb: 1 }}>Projects</Typography>
          <List dense aria-label="Projects">
            {(projects.data ?? []).map((p) => (
              <ListItem key={p.id} disableGutters secondaryAction={
                <Chip size="small" variant="outlined" label={`${p.releases} release${p.releases === 1 ? '' : 's'}`} />}>
                <ListItemAvatar><Avatar variant="rounded" sx={{ bgcolor: '#0ea5a01f', color: '#0ea5a0' }}><FolderIcon /></Avatar></ListItemAvatar>
                <ListItemText primary={p.name}
                  secondary={`${p.approvedTasks} approved · ${clock(p.approvedAudioMs, 0)} of approved audio`} />
              </ListItem>
            ))}
          </List>
        </Card>
        <Card sx={{ p: 2.5, flex: 1 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="h3" sx={{ fontSize: 16, fontWeight: 700 }}>Recent access to customer data</Typography>
            <ShieldIcon fontSize="small" color="action" />
          </Stack>
          {access.error ? <Alert severity="warning">Access log unavailable.</Alert>
            : (access.data ?? []).length === 0 && !access.isLoading
              ? <Typography sx={{ color: 'text.secondary', fontSize: 14 }}>No access recorded yet.</Typography>
              : (
                <List dense aria-label="Recent access">
                  {(access.data ?? []).map((e) => (
                    <ListItem key={e.id} disableGutters secondaryAction={
                      <Chip size="small" color={e.outcome === 'ALLOWED' ? 'default' : 'error'} variant="outlined"
                        label={e.outcome === 'ALLOWED' ? 'allowed' : 'denied'} />}>
                      <ListItemText
                        primary={`${e.actorName} ${e.action === 'READ_AUDIO' ? 'played audio of' : 'opened'} ${e.taskTitle}`}
                        secondary={relativeTime(e.createdAt)} />
                    </ListItem>
                  ))}
                </List>
              )}
        </Card>
      </Stack>
    </Stack>
  );
}
