import type { ReactNode } from 'react';
import { Avatar, Box, Card, LinearProgress, Stack, Tooltip, Typography } from '@mui/material';

export function StatCard({ icon, label, value, total, color, hint }: {
  icon: ReactNode; label: string; value: number | string; total?: number; color: string; hint?: string;
}) {
  const share = total && typeof value === 'number' ? (value / total) * 100 : undefined;
  return (
    <Card sx={{ p: 2, flex: '1 1 180px', position: 'relative', overflow: 'hidden' }}>
      <Box sx={{ position: 'absolute', right: -18, top: -18, width: 80, height: 80, borderRadius: '50%', bgcolor: `${color}14` }} />
      <Stack direction="row" spacing={1.5} alignItems="center">
        <Avatar variant="rounded" sx={{ bgcolor: `${color}1f`, color, width: 40, height: 40, borderRadius: 2.5 }}>{icon}</Avatar>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: 12.5, color: 'text.secondary', fontWeight: 550 }}>{label}</Typography>
          <Typography sx={{ fontSize: 26, fontWeight: 750, lineHeight: 1.15, fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>
        </Box>
      </Stack>
      {share !== undefined ? (
        <Tooltip title={`${Math.round(share)}% of all tasks`}>
          <LinearProgress variant="determinate" value={share}
            sx={{ mt: 1.75, height: 5, borderRadius: 9, bgcolor: `${color}1c`, '& .MuiLinearProgress-bar': { bgcolor: color, borderRadius: 9 } }} />
        </Tooltip>
      ) : (
        <Typography sx={{ mt: 1.25, fontSize: 12, color: 'text.secondary' }}>{hint}</Typography>
      )}
    </Card>
  );
}
