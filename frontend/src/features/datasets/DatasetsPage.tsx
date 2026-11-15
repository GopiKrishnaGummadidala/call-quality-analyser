import { Fragment, useState } from 'react';
import type { ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert, Box, Button, Card, Chip, Collapse, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle,
  IconButton, Skeleton, Stack, Tab, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tabs, Tooltip,
  Typography,
} from '@mui/material';
import FactCheckIcon from '@mui/icons-material/FactCheckOutlined';
import ShieldIcon from '@mui/icons-material/ShieldOutlined';
import Inventory2Icon from '@mui/icons-material/Inventory2Outlined';
import ModelTrainingIcon from '@mui/icons-material/ModelTraining';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import DownloadIcon from '@mui/icons-material/Download';
import AddIcon from '@mui/icons-material/Add';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DatasetIcon from '@mui/icons-material/DatasetOutlined';
import { api, ApiError, fetchProtected } from '../../shared/api';
import { useAuth } from '../../shared/auth';
import { clock, relativeTime } from '../../shared/format';
import type { DatasetRelease } from '../../shared/types';

const SPLIT_COLOR = { train: '#6366f1', val: '#0ea5a0', test: '#f59e0b' } as const;

const STAGES: { icon: ReactNode; title: string; text: string }[] = [
  { icon: <FactCheckIcon />, title: 'Approved annotations', text: 'Only work a reviewer approved' },
  { icon: <ShieldIcon />, title: 'De-identify', text: 'Names, numbers, IBANs, cards, dates, e-mails' },
  { icon: <Inventory2Icon />, title: 'Versioned release', text: 'Immutable, SHA-256, stable splits' },
  { icon: <ModelTrainingIcon />, title: 'Training', text: 'Inside a DPA-covered environment' },
];

function Pipeline() {
  return (
    <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems={{ md: 'center' }} aria-label="Release pipeline">
      {STAGES.map((s, i) => (
        <Fragment key={s.title}>
          <Card sx={{ p: 1.5, flex: 1, display: 'flex', gap: 1.5, alignItems: 'center' }}>
            <Box sx={{ width: 36, height: 36, borderRadius: 2.5, display: 'grid', placeItems: 'center', bgcolor: 'action.hover', color: 'secondary.main', flexShrink: 0 }}>
              {s.icon}
            </Box>
            <Box>
              <Typography sx={{ fontWeight: 650, fontSize: 14 }}>{i + 1}. {s.title}</Typography>
              <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{s.text}</Typography>
            </Box>
          </Card>
          {i < STAGES.length - 1 && (
            <ArrowForwardIcon sx={{ color: 'text.disabled', alignSelf: 'center', transform: { xs: 'rotate(90deg)', md: 'none' } }} />
          )}
        </Fragment>
      ))}
    </Stack>
  );
}

function SplitBar({ splits }: { splits: DatasetRelease['splits'] }) {
  const total = splits.train + splits.val + splits.test || 1;
  return (
    <Tooltip title={`train ${splits.train} · val ${splits.val} · test ${splits.test}`}>
      <Stack spacing={0.5} sx={{ minWidth: 110 }}>
        <Stack direction="row" sx={{ height: 8, borderRadius: 9, overflow: 'hidden', bgcolor: 'action.hover' }}>
          {(['train', 'val', 'test'] as const).map((k) => (
            <Box key={k} sx={{ width: `${(splits[k] / total) * 100}%`, bgcolor: SPLIT_COLOR[k] }} />
          ))}
        </Stack>
        <Typography sx={{ fontSize: 11.5, color: 'text.secondary' }}>{splits.train} / {splits.val} / {splits.test}</Typography>
      </Stack>
    </Tooltip>
  );
}

async function download(r: DatasetRelease) {
  const bytes = await fetchProtected(`/api/admin/datasets/${r.id}/manifest.jsonl`);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/x-ndjson' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${r.projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-v${r.version}.jsonl`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ReleaseRow({ r }: { r: DatasetRelease }) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const detail = useQuery({ queryKey: ['release', r.id], queryFn: () => api.releaseDetail(r.id), enabled: open });
  const redactions = Object.values(r.redactions).reduce((a, b) => a + b, 0);
  return (
    <>
      <TableRow sx={{ '& > td': { borderBottom: open ? 0 : undefined } }}>
        <TableCell>
          <Chip label={`v${r.version}`} size="small" color="primary" sx={{ fontWeight: 700 }} />
        </TableCell>
        <TableCell sx={{ whiteSpace: 'nowrap' }}>
          <Typography sx={{ fontSize: 13.5 }} title={new Date(r.createdAt).toLocaleString()}>{relativeTime(r.createdAt)}</Typography>
          <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{r.createdByName}</Typography>
        </TableCell>
        <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{r.itemCount}</TableCell>
        <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{clock(r.audioMs, 0)}</TableCell>
        <TableCell><SplitBar splits={r.splits} /></TableCell>
        <TableCell>
          <Tooltip title={Object.entries(r.redactions).map(([k, v]) => `${k} ${v}`).join(' · ') || 'none'}>
            <Chip size="small" variant="outlined" label={`${redactions} redacted`} />
          </Tooltip>
        </TableCell>
        <TableCell>
          <Stack direction="row" alignItems="center" spacing={0.5}>
            <Typography sx={{ fontFamily: 'ui-monospace, monospace', fontSize: 12.5 }} title={r.manifestSha256}>
              {r.manifestSha256.slice(0, 12)}…
            </Typography>
            <Tooltip title="Copy SHA-256">
              <IconButton size="small" aria-label={`Copy SHA-256 of v${r.version}`}
                onClick={() => { void navigator.clipboard?.writeText(r.manifestSha256); }}>
                <ContentCopyIcon sx={{ fontSize: 15 }} />
              </IconButton>
            </Tooltip>
          </Stack>
        </TableCell>
        <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
          <Button size="small" endIcon={<ExpandMoreIcon sx={{ transform: open ? 'rotate(180deg)' : 'none' }} />}
            onClick={() => setOpen((v) => !v)} aria-expanded={open}>Preview</Button>
          <Button size="small" variant="outlined" startIcon={<DownloadIcon />} sx={{ ml: 1, borderRadius: 99 }}
            aria-label={`Download manifest v${r.version}`}
            onClick={() => { void download(r).then(() => client.invalidateQueries({ queryKey: ['releases', r.projectId] })); }}>
            {r.downloads > 0 ? `Download (${r.downloads})` : 'Download'}
          </Button>
        </TableCell>
      </TableRow>
      <TableRow>
        <TableCell colSpan={8} sx={{ py: 0 }}>
          <Collapse in={open} unmountOnExit>
            <Box sx={{ py: 2 }}>
              <Typography sx={{ fontSize: 12.5, color: 'text.secondary', mb: 1 }}>
                First records of the manifest ({r.deidPolicy}), exactly as a training job receives them:
              </Typography>
              {detail.isLoading && <Skeleton variant="rounded" height={120} />}
              {detail.data && (
                <Box component="pre" aria-label={`Preview of release v${r.version}`} sx={{
                  m: 0, p: 1.5, maxHeight: 280, overflow: 'auto', borderRadius: 2, bgcolor: 'action.hover',
                  fontSize: 12, fontFamily: 'ui-monospace, monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}>
                  {detail.data.preview.map((p) => JSON.stringify(p, null, 2)).join('\n\n')}
                </Box>
              )}
            </Box>
          </Collapse>
        </TableCell>
      </TableRow>
    </>
  );
}

export function DatasetsPage() {
  const { user } = useAuth();
  const client = useQueryClient();
  const projects = useQuery({ queryKey: ['dataProjects'], queryFn: api.dataProjects });
  const [selected, setSelected] = useState<string | null>(null);
  const project = projects.data?.find((p) => p.id === selected) ?? projects.data?.[0];
  const releases = useQuery({ queryKey: ['releases', project?.id], queryFn: () => api.releases(project!.id), enabled: !!project });
  const [confirm, setConfirm] = useState(false);
  const create = useMutation({
    mutationFn: () => api.createRelease(project!.id),
    onSuccess: () => {
      setConfirm(false);
      void client.invalidateQueries({ queryKey: ['releases', project?.id] });
      void client.invalidateQueries({ queryKey: ['dataProjects'] });
    },
  });
  const latest = releases.data?.[0];
  const nextVersion = (latest?.version ?? 0) + 1;
  const newSinceLatest = latest && project ? project.approvedTasks - latest.itemCount : null;

  return (
    <Stack component="section" aria-labelledby="datasets-title" spacing={3}>
      <Box>
        <Typography variant="overline" color="secondary.main">{user?.tenantName}</Typography>
        <Stack direction="row" spacing={1.25} alignItems="center">
          <DatasetIcon color="primary" />
          <Typography variant="h1" id="datasets-title">Training data</Typography>
        </Stack>
        <Typography sx={{ color: 'text.secondary', mt: 0.5 }}>
          Approved annotations become versioned, de-identified releases that a training job can consume and verify.
        </Typography>
      </Box>

      <Pipeline />

      <Alert severity="warning" role="note" variant="outlined">
        Transcripts are de-identified; the <b>audio is not</b> (names and account details are still spoken). Every record
        says so (<code>contains_identifiers</code>): train on audio only inside an environment covered by a data processing agreement.
      </Alert>

      {projects.isLoading && <Skeleton variant="rounded" height={160} />}
      {projects.data && project && (
        <Card sx={{ overflow: 'hidden' }}>
          <Box sx={{ px: 2, pt: 1, borderBottom: 1, borderColor: 'divider' }}>
            <Tabs value={project.id} onChange={(_, v: string) => setSelected(v)} aria-label="Project" variant="scrollable">
              {projects.data.map((p) => <Tab key={p.id} value={p.id} label={`${p.name} · ${p.releases}`} sx={{ minHeight: 52 }} />)}
            </Tabs>
          </Box>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }} sx={{ p: 2.5 }}>
            <Box sx={{ flex: 1 }}>
              <Typography sx={{ fontWeight: 650 }}>Ready for release v{nextVersion}</Typography>
              <Typography sx={{ fontSize: 13.5, color: 'text.secondary' }}>
                {project.approvedTasks} approved task{project.approvedTasks === 1 ? '' : 's'} · {clock(project.approvedAudioMs, 0)} of audio
                {newSinceLatest !== null && ` · ${newSinceLatest} new since v${latest!.version}`}
              </Typography>
            </Box>
            <Button variant="contained" startIcon={<AddIcon />} disabled={project.approvedTasks === 0}
              onClick={() => setConfirm(true)} sx={{ borderRadius: 99 }}>
              Create release v{nextVersion}
            </Button>
          </Stack>
          {create.error && (
            <Alert severity="error" role="alert" sx={{ mx: 2.5, mb: 2 }}>
              {create.error instanceof ApiError ? create.error.violations[0] ?? create.error.message : 'Release failed'}
            </Alert>
          )}

          {releases.data && releases.data.length === 0 && (
            <Typography sx={{ px: 2.5, pb: 2.5, color: 'text.secondary', fontSize: 14 }}>No releases yet for this project.</Typography>
          )}
          {releases.data && releases.data.length > 0 && (
            <TableContainer>
              <Table size="small" aria-label="Releases" sx={{ minWidth: 900 }}>
                <TableHead>
                  <TableRow sx={{ bgcolor: 'action.hover' }}>
                    <TableCell>Version</TableCell><TableCell>Created</TableCell><TableCell align="right">Items</TableCell>
                    <TableCell align="right">Audio</TableCell><TableCell>Train / val / test</TableCell><TableCell>De-identified</TableCell>
                    <TableCell>Manifest SHA-256</TableCell><TableCell />
                  </TableRow>
                </TableHead>
                <TableBody>{releases.data.map((r) => <ReleaseRow key={r.id} r={r} />)}</TableBody>
              </Table>
            </TableContainer>
          )}
        </Card>
      )}

      <Dialog open={confirm} onClose={() => setConfirm(false)}>
        <DialogTitle>Create release v{nextVersion} of {project?.name}?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {project?.approvedTasks} approved annotations are de-identified (policy pii-text-v1), split into
            train/val/test and frozen as an immutable, hashed release. The release and every download are audited.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(false)}>Cancel</Button>
          <Button variant="contained" disabled={create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? 'Creating…' : 'Create release'}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
