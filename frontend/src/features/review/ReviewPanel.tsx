import { useState } from 'react';
import { Box, Button, Card, Stack, TextField, Typography } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircleOutline';
import ReplayIcon from '@mui/icons-material/ReplayOutlined';
import GavelIcon from '@mui/icons-material/GavelRounded';
import { api, ApiError } from '../../shared/api';
import type { TaskDetail } from '../../shared/types';

interface Props { task: TaskDetail; onDone: (task: TaskDetail) => void }

export function ReviewPanel({ task, onDone }: Props) {
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reasonMissing, setReasonMissing] = useState(false);

  async function decide(decision: 'APPROVE' | 'REQUEST_CHANGES') {
    if (decision === 'REQUEST_CHANGES' && comment.trim() === '') {
      setReasonMissing(true);
      setError('A reason is required when requesting changes');
      return;
    }
    setReasonMissing(false);
    setError(null);
    setBusy(true);
    try {
      onDone(await api.reviewTask(task.id, decision, comment.trim()));
    } catch (e) {
      setError(e instanceof ApiError ? e.violations[0] ?? e.message : 'Review failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card component="section" aria-labelledby="review-title" sx={{
      p: 2.5, borderColor: 'primary.main',
      background: 'linear-gradient(180deg, color-mix(in srgb, var(--mui-palette-primary-main) 9%, transparent), transparent 70%)',
    }}>
      <Stack direction="row" spacing={1.25} alignItems="center" sx={{ mb: 0.5 }}>
        <Box sx={{ width: 32, height: 32, borderRadius: 2, display: 'grid', placeItems: 'center', bgcolor: 'primary.main', color: 'primary.contrastText' }}>
          <GavelIcon fontSize="small" />
        </Box>
        <Typography variant="h2" id="review-title">Review</Typography>
      </Stack>
      <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 2 }}>
        Approve the annotation, or send it back with a reason.
      </Typography>
      <TextField label="Reason / comment" multiline minRows={3} fullWidth value={comment}
        onChange={(e) => { setComment(e.target.value); if (e.target.value.trim()) setReasonMissing(false); }} error={reasonMissing} />
      {error && <Typography role="alert" sx={{ color: 'error.main', fontSize: 13, mt: 1 }}>{error}</Typography>}
      <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
        <Button variant="contained" color="success" startIcon={<CheckCircleIcon />} disabled={busy} fullWidth
          onClick={() => { void decide('APPROVE'); }}>Approve</Button>
        <Button variant="outlined" color="warning" startIcon={<ReplayIcon />} disabled={busy} fullWidth
          onClick={() => { void decide('REQUEST_CHANGES'); }}>Request changes</Button>
      </Stack>
    </Card>
  );
}
