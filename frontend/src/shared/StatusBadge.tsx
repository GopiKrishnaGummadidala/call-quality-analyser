import { Box, Chip } from '@mui/material';
import type { TaskStatus } from './types';

export const STATUS_META: Record<TaskStatus, { label: string; color: string }> = {
  IN_PROGRESS: { label: 'In progress', color: '#3b82f6' },
  SUBMITTED: { label: 'Submitted', color: '#8b5cf6' },
  CHANGES_REQUESTED: { label: 'Changes requested', color: '#f59e0b' },
  APPROVED: { label: 'Approved', color: '#10b981' },
};

export function StatusBadge({ status, size = 'small' }: { status: TaskStatus; size?: 'small' | 'medium' }) {
  const { label, color } = STATUS_META[status];
  return (
    <Chip
      size={size}
      label={label}
      icon={<Box component="span" sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: color, ml: '10px !important', boxShadow: `0 0 0 3px ${color}33` }} />}
      sx={{
        fontWeight: 650, fontSize: 12, color, border: `1px solid ${color}55`,
        bgcolor: `color-mix(in srgb, ${color} 12%, transparent)`,
      }}
    />
  );
}
