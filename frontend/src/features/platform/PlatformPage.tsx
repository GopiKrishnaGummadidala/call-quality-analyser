import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert, Box, Button, Card, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Skeleton, Stack,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography,
} from '@mui/material';
import DnsIcon from '@mui/icons-material/DnsOutlined';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import { api } from '../../shared/api';

/**
 * Platform operations: tenant sizes (counts only, never customer content) and the demo reset, which re-seeds
 * every organisation and is therefore not available to any tenant admin.
 */
export function PlatformPage() {
  const client = useQueryClient();
  const tenants = useQuery({ queryKey: ['platformTenants'], queryFn: api.platformTenants });
  const [confirm, setConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [done, setDone] = useState(false);

  async function reset() {
    setResetting(true);
    try {
      await api.resetDemo();
      client.clear();
      setDone(true);
      void tenants.refetch();
    } finally {
      setResetting(false);
      setConfirm(false);
    }
  }

  return (
    <Stack component="section" aria-labelledby="platform-title" spacing={3}>
      <Box>
        <Typography variant="overline" color="secondary.main">Platform operator</Typography>
        <Stack direction="row" spacing={1.25} alignItems="center">
          <DnsIcon color="action" />
          <Typography variant="h1" id="platform-title">Platform</Typography>
        </Stack>
        <Typography sx={{ color: 'text.secondary', mt: 0.5 }}>
          Organisations on this platform and their size. The operator belongs to none of them and sees no tasks,
          transcripts or recordings.
        </Typography>
      </Box>

      {done && <Alert severity="success" role="status" onClose={() => setDone(false)}>Demo data was reset for every organisation.</Alert>}

      <Card sx={{ overflow: 'hidden' }}>
        <Typography variant="h2" sx={{ px: 2.5, py: 2, borderBottom: 1, borderColor: 'divider' }}>Organisations</Typography>
        {tenants.isLoading && <Box sx={{ p: 2 }}><Skeleton height={40} /><Skeleton height={40} /></Box>}
        {tenants.error && <Alert severity="error" role="alert" sx={{ m: 2 }}>Could not load organisations.</Alert>}
        {tenants.data && (
          <TableContainer>
            <Table aria-label="Organisations" sx={{ minWidth: 620 }}>
              <TableHead>
                <TableRow sx={{ bgcolor: 'action.hover' }}>
                  <TableCell>Organisation</TableCell><TableCell align="right">Users</TableCell><TableCell align="right">Projects</TableCell>
                  <TableCell align="right">Tasks</TableCell><TableCell align="right">Approved</TableCell><TableCell align="right">Releases</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {tenants.data.map((t) => (
                  <TableRow key={t.id} sx={{ '&:last-child td': { border: 0 } }}>
                    <TableCell>
                      <Typography sx={{ fontWeight: 600, fontSize: 14 }}>{t.name}</Typography>
                      <Typography sx={{ fontSize: 12, color: 'text.secondary', fontFamily: 'ui-monospace, monospace' }}>{t.id}</Typography>
                    </TableCell>
                    {[t.users, t.projects, t.tasks, t.approvedTasks, t.releases].map((n, i) => (
                      <TableCell key={i} align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{n}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Card>

      <Card sx={{ p: 2.5, borderColor: 'error.main', maxWidth: 560 }}>
        <Typography variant="h2">Demo data</Typography>
        <Typography sx={{ fontSize: 13.5, color: 'text.secondary', mt: 1, mb: 2 }}>
          Re-seed every organisation: users, tasks, annotations, logs and training-data releases. Everyone keeps the demo
          password; open editors will show a conflict.
        </Typography>
        <Button variant="outlined" color="error" startIcon={<RestartAltIcon />} onClick={() => setConfirm(true)}>
          Reset demo data
        </Button>
      </Card>

      <Dialog open={confirm} onClose={() => setConfirm(false)}>
        <DialogTitle>Reset demo data for every organisation?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            All annotations, reviews, audit and access logs and releases are deleted and the seed data is restored for
            all organisations. This cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(false)}>Cancel</Button>
          <Button color="error" variant="contained" disabled={resetting} onClick={() => { void reset(); }}>
            {resetting ? 'Resetting…' : 'Reset'}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
