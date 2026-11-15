import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Box, Card, Skeleton, Stack, Tooltip, Typography } from '@mui/material';
import HistoryIcon from '@mui/icons-material/History';
import SendIcon from '@mui/icons-material/Send';
import CheckIcon from '@mui/icons-material/Check';
import ReplayIcon from '@mui/icons-material/Replay';
import BoltIcon from '@mui/icons-material/Bolt';
import { api } from '../../shared/api';
import { relativeTime } from '../../shared/format';

const ACTION: Record<string, { label: string; color: string; icon: ReactNode }> = {
  TASK_SUBMITTED: { label: 'submitted the task', color: '#8b5cf6', icon: <SendIcon sx={{ fontSize: 14 }} /> },
  TASK_APPROVED: { label: 'approved the task', color: '#10b981', icon: <CheckIcon sx={{ fontSize: 15 }} /> },
  TASK_CHANGES_REQUESTED: { label: 'requested changes', color: '#f59e0b', icon: <ReplayIcon sx={{ fontSize: 15 }} /> },
};

export function AuditTimeline({ taskId }: { taskId: string }) {
  const { data, isLoading, error } = useQuery({ queryKey: ['audit', taskId], queryFn: () => api.audit(taskId) });
  return (
    <Card component="section" aria-labelledby="audit-title" sx={{ p: 2.5 }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
        <HistoryIcon sx={{ color: 'text.secondary' }} />
        <Typography variant="h2" id="audit-title">Audit history</Typography>
      </Stack>
      {isLoading && <><Skeleton height={36} /><Skeleton height={36} /></>}
      {error && <Typography role="alert" color="error">Could not load history.</Typography>}
      {data && data.length === 0 && (
        <Stack alignItems="center" spacing={1} sx={{ py: 2, color: 'text.secondary' }}>
          <HistoryIcon sx={{ opacity: 0.4, fontSize: 32 }} />
          <Typography sx={{ fontSize: 13.5 }}>No state changes yet.</Typography>
        </Stack>
      )}
      {data && data.length > 0 && (
        <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 0 }}>
          {data.map((e, i) => {
            const meta = ACTION[e.action] ?? { label: e.action, color: '#64748b', icon: <BoltIcon sx={{ fontSize: 14 }} /> };
            const last = i === data.length - 1;
            return (
              <Box component="li" key={e.id} sx={{ display: 'flex', gap: 1.5, position: 'relative', pb: last ? 0 : 2 }}>
                {!last && <Box sx={{ position: 'absolute', left: 13, top: 30, bottom: 2, width: 2, bgcolor: 'divider' }} />}
                <Box sx={{
                  width: 28, height: 28, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center',
                  bgcolor: `${meta.color}22`, color: meta.color, border: `1.5px solid ${meta.color}66`,
                }}>{meta.icon}</Box>
                <Box sx={{ pt: 0.25 }}>
                  <Typography sx={{ fontSize: 14 }}><b>{e.actorName}</b> {meta.label}</Typography>
                  <Tooltip title={new Date(e.createdAt).toLocaleString()} placement="bottom-start">
                    <Typography component="time" dateTime={e.createdAt} sx={{ fontSize: 12, color: 'text.secondary' }}>
                      {relativeTime(e.createdAt)}
                    </Typography>
                  </Tooltip>
                </Box>
              </Box>
            );
          })}
        </Box>
      )}
    </Card>
  );
}
