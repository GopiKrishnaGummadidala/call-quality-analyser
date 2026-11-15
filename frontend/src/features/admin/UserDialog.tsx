import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField, Typography,
} from '@mui/material';
import { api, ApiError } from '../../shared/api';
import type { AdminUser, Role, UserInput } from '../../shared/types';

const USERNAME = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const MIN_PASSWORD = 7; // same rule as the server (UserManagementService)

type ProjectRole = Role | '';

function passwordProblem(pw: string, required: boolean): string | undefined {
  if (!pw) return required ? 'Password is required' : undefined;
  if (pw.length < MIN_PASSWORD || pw.length > 128 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw)) {
    return `At least ${MIN_PASSWORD} characters with a letter and a digit`;
  }
  return undefined;
}

/** Add a user (no `user`) or edit one. Mirrors the server rules so mistakes show as red fields before saving. */
export function UserDialog({ user, isSelf, onClose, onSaved }: {
  user?: AdminUser; isSelf?: boolean; onClose: () => void; onSaved: (message: string) => void;
}) {
  const editing = !!user;
  const qc = useQueryClient();
  const projects = useQuery({ queryKey: ['data-projects'], queryFn: api.dataProjects });
  const [username, setUsername] = useState(user?.username ?? '');
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [password, setPassword] = useState('');
  const [globalRole, setGlobalRole] = useState<'USER' | 'ADMIN'>(user?.globalRole === 'ADMIN' ? 'ADMIN' : 'USER');
  const [roles, setRoles] = useState<Record<string, ProjectRole>>(
    Object.fromEntries((user?.memberships ?? []).map((m) => [m.projectId, m.role])),
  );
  const [tried, setTried] = useState(false);

  const errors = {
    username: editing ? undefined
      : !username.trim() ? 'Username is required'
      : !USERNAME.test(username.trim().toLowerCase()) ? '3–32 characters: lowercase letters, digits, dot, dash or underscore' : undefined,
    displayName: !displayName.trim() ? 'Full name is required' : displayName.trim().length > 200 ? 'At most 200 characters' : undefined,
    password: passwordProblem(password, !editing),
  };
  const valid = !errors.username && !errors.displayName && !errors.password;
  const show = (field: keyof typeof errors) => (tried ? errors[field] : undefined);

  const save = useMutation({
    mutationFn: () => {
      const input: UserInput = {
        displayName: displayName.trim(),
        globalRole,
        memberships: globalRole === 'ADMIN' ? [] : Object.entries(roles)
          .filter(([, r]) => r !== '').map(([projectId, role]) => ({ projectId, role: role as Role })),
        ...(password ? { password } : {}),
      };
      return editing ? api.updateUser(user!.id, input) : api.createUser({ ...input, username: username.trim().toLowerCase() });
    },
    onSuccess: async (saved) => {
      await qc.invalidateQueries({ queryKey: ['adminUsers'] });
      await qc.invalidateQueries({ queryKey: ['accountEvents'] });
      onSaved(editing ? `${saved.displayName} updated` : `${saved.displayName} added`);
    },
  });
  const serverError = save.error instanceof ApiError ? save.error : undefined;

  const submit = () => {
    setTried(true);
    if (valid) save.mutate();
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="user-dialog-title">
      <DialogTitle id="user-dialog-title">{editing ? `Edit ${user!.displayName}` : 'Add user'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2.25} sx={{ pt: 1 }} component="form" noValidate onSubmit={(e) => { e.preventDefault(); submit(); }}>
          {serverError && (
            <Alert severity="error" role="alert">
              {serverError.violations.length > 0
                ? <>{serverError.message}<Box component="ul" sx={{ m: 0, pl: 2.5 }}>{serverError.violations.map((v) => <li key={v}>{v}</li>)}</Box></>
                : serverError.message}
            </Alert>
          )}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField label="Username" value={username} onChange={(e) => setUsername(e.target.value)} disabled={editing}
              required={!editing} fullWidth autoFocus={!editing} error={!!show('username')}
              helperText={show('username') ?? (editing ? 'Usernames cannot change' : 'Used to sign in')} />
            <TextField label="Full name" value={displayName} onChange={(e) => setDisplayName(e.target.value)}
              required fullWidth autoFocus={editing} error={!!show('displayName')} helperText={show('displayName')} />
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField select label="Account role" value={globalRole} fullWidth disabled={isSelf}
              onChange={(e) => setGlobalRole(e.target.value as 'USER' | 'ADMIN')}
              helperText={isSelf ? 'You cannot remove your own admin role' : 'Admins manage the organisation and hold no project roles'}>
              <MenuItem value="USER">User</MenuItem>
              <MenuItem value="ADMIN">Admin</MenuItem>
            </TextField>
            <TextField label={editing ? 'New password' : 'Password'} type="password" value={password} fullWidth
              required={!editing} autoComplete="new-password" onChange={(e) => setPassword(e.target.value)}
              error={!!show('password')}
              helperText={show('password') ?? (editing ? 'Leave empty to keep it. A new one signs the user out everywhere.' : `At least ${MIN_PASSWORD} characters with a letter and a digit`)} />
          </Stack>

          <Box>
            <Typography sx={{ fontWeight: 650, fontSize: 14.5 }}>Project roles</Typography>
            <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 1.25 }}>
              {globalRole === 'ADMIN' ? 'Admins do not annotate or review, so they have no project roles.'
                : 'Changes apply on the user\'s next click; nothing else in the organisation is visible to them.'}
            </Typography>
            <Stack spacing={1.25}>
              {(projects.data ?? []).map((p) => (
                <TextField key={p.id} select size="small" label={p.name} value={globalRole === 'ADMIN' ? '' : roles[p.id] ?? ''}
                  disabled={globalRole === 'ADMIN'} onChange={(e) => setRoles((r) => ({ ...r, [p.id]: e.target.value as ProjectRole }))}>
                  <MenuItem value="">No access</MenuItem>
                  <MenuItem value="ANNOTATOR">Annotator</MenuItem>
                  <MenuItem value="REVIEWER">Reviewer</MenuItem>
                </TextField>
              ))}
            </Stack>
          </Box>
          <button type="submit" hidden />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={save.isPending}>
          {editing ? 'Save changes' : 'Add user'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
