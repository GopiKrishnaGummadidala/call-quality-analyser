import { useMemo } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import { Box, ButtonBase, Paper, Typography } from '@mui/material';
import { SPEAKER_COLOR, SPEAKER_NAME } from '../../app/theme';
import { clock } from '../../shared/format';
import type { Segment } from './types';

interface Props {
  peaks: number[] | null;
  bins: number;
  durationMs: number;
  segments: Segment[];
  lanes: number[];
  currentMs: number;
  activeIndex: number;
  onSeek: (ms: number) => void;
  onJump: (index: number) => void;
}

const WAVE_H = 150;
const LANE_H = 30;
const pct = (ms: number, d: number) => `${(Math.min(Math.max(ms, 0), d) / d) * 100}%`;

/** Waveform + speaker-coloured segment regions + playhead + per-lane segment pills + time ruler. */
export function Waveform({ peaks, bins, durationMs, segments, lanes, currentMs, activeIndex, onSeek, onJump }: Props) {
  const laneCount = Math.max(1, ...lanes.map((l) => l + 1));
  const d = Math.max(durationMs, 1);

  // Colour each bar by the speaker of the segment covering it (first match), neutral otherwise.
  const barColors = useMemo(() => Array.from({ length: bins }, (_, b) => {
    const t = ((b + 0.5) / bins) * d;
    const seg = segments.find((s) => t >= s.startMs && t < s.endMs);
    return seg ? SPEAKER_COLOR[seg.speaker] : null;
  }), [bins, d, segments]);

  const tickStep = d <= 10_000 ? 1000 : d <= 60_000 ? 5000 : 15_000;
  const ticks = Array.from({ length: Math.floor(d / tickStep) + 1 }, (_, i) => i * tickStep);

  function seekFromPointer(e: MouseEvent<HTMLElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    onSeek(((e.clientX - rect.left) / rect.width) * d);
  }
  function onKey(e: KeyboardEvent<HTMLElement>) {
    const step = e.shiftKey ? 1000 : 250;
    if (e.key === 'ArrowLeft') { e.preventDefault(); onSeek(currentMs - step); }
    if (e.key === 'ArrowRight') { e.preventDefault(); onSeek(currentMs + step); }
    if (e.key === 'Home') { e.preventDefault(); onSeek(0); }
    if (e.key === 'End') { e.preventDefault(); onSeek(d); }
  }

  return (
    <Box sx={{ userSelect: 'none' }}>
      {/* waveform canvas */}
      <Box role="slider" tabIndex={0} aria-label="Audio position" aria-valuemin={0} aria-valuemax={Math.round(d / 1000)}
        aria-valuenow={Math.round(currentMs / 1000)} aria-valuetext={`${clock(currentMs)} of ${clock(d)}`}
        onClick={seekFromPointer} onKeyDown={onKey}
        sx={{
          position: 'relative', height: WAVE_H, borderRadius: 3, overflow: 'hidden', cursor: 'pointer',
          background: 'linear-gradient(180deg, var(--mui-palette-action-hover) 0%, transparent 100%)',
          border: 1, borderColor: 'divider',
          '&:focus-visible': { outline: '2px solid var(--mui-palette-primary-main)', outlineOffset: 2 },
        }}>
        {segments.map((s, i) => {
          const c = SPEAKER_COLOR[s.speaker];
          return (
            <Box key={s.id} sx={{
              position: 'absolute', top: 0, bottom: 0, left: pct(s.startMs, d), width: pct(s.endMs - s.startMs, d),
              bgcolor: `${c}${i === activeIndex ? '2e' : '17'}`, borderLeft: `1px solid ${c}66`, borderRight: `1px solid ${c}66`,
              transition: 'background-color .2s',
            }}>
              <Paper variant="outlined" sx={{
                position: 'absolute', top: 6 + lanes[i] * 24, left: 6, px: 0.75, py: 0.1, borderRadius: 1.5,
                fontSize: 11, fontWeight: 650, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums',
                borderColor: `${c}66`, color: 'text.primary', bgcolor: 'background.paper',
              }}>
                {clock(s.startMs, 1)} – {clock(s.endMs, 1)}
              </Paper>
            </Box>
          );
        })}

        <Box component="svg" viewBox={`0 0 ${bins} 100`} preserveAspectRatio="none" aria-hidden
          sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
          <line x1={0} x2={bins} y1={50} y2={50} stroke="currentColor" strokeOpacity={0.18} strokeWidth={0.4} vectorEffect="non-scaling-stroke" />
          {peaks?.map((p, b) => {
            const h = Math.max(1.5, p * 78);
            const played = ((b + 0.5) / bins) * d <= currentMs;
            return (
              <rect key={b} x={b + 0.2} width={0.6} y={50 - h / 2} height={h} rx={0.3}
                fill={barColors[b] ?? 'var(--mui-palette-text-secondary)'} opacity={played ? 1 : 0.5} />
            );
          })}
        </Box>

        {!peaks && (
          <Typography sx={{ position: 'absolute', right: 10, bottom: 8, fontSize: 11, color: 'text.secondary' }}>
            Waveform unavailable · timeline still works
          </Typography>
        )}

        {/* playhead */}
        <Box aria-hidden sx={{
          position: 'absolute', top: 0, bottom: 0, left: pct(currentMs, d), width: 2, ml: '-1px',
          bgcolor: 'primary.main', boxShadow: '0 0 0 1px var(--mui-palette-background-paper)', pointerEvents: 'none',
          '&::before': {
            content: '""', position: 'absolute', top: -1, left: -5, width: 12, height: 12, borderRadius: '50%',
            bgcolor: 'primary.main', border: '2px solid var(--mui-palette-background-paper)',
          },
        }} />
      </Box>

      {/* speaker lanes */}
      <Box sx={{ position: 'relative', height: laneCount * LANE_H + 6, mt: 0.75 }}>
        {segments.map((s, i) => {
          const c = SPEAKER_COLOR[s.speaker];
          return (
            <ButtonBase key={s.id} onClick={() => onJump(i)} aria-label={`Jump to segment ${i + 1}`}
              title={`${i + 1}: ${SPEAKER_NAME[s.speaker]} · ${clock(s.startMs)} – ${clock(s.endMs)}`}
              sx={{
                position: 'absolute', top: lanes[i] * LANE_H + 3, height: LANE_H - 4,
                left: `calc(${pct(s.startMs, d)} + 1px)`, width: `calc(${pct(s.endMs - s.startMs, d)} - 2px)`, minWidth: 18,
                borderRadius: 2, bgcolor: c, color: '#fff', fontSize: 12, fontWeight: 650, px: 1,
                justifyContent: 'flex-start', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                boxShadow: i === activeIndex ? `0 0 0 2px var(--mui-palette-background-paper), 0 0 0 4px ${c}` : `0 2px 6px ${c}40`,
                transition: 'transform .12s, box-shadow .12s',
                '&:hover': { transform: 'translateY(-1px)' },
              }}>
              {i + 1} · {SPEAKER_NAME[s.speaker]}
            </ButtonBase>
          );
        })}
      </Box>

      {/* ruler */}
      <Box aria-hidden sx={{ position: 'relative', height: 18, mt: 0.25 }}>
        {ticks.map((t) => (
          <Box key={t} sx={{
            position: 'absolute', left: pct(t, d), transform: t === 0 ? 'none' : t >= d ? 'translateX(-100%)' : 'translateX(-50%)',
            fontSize: 10.5, color: 'text.secondary', fontVariantNumeric: 'tabular-nums',
            '&::before': { content: '""', display: 'block', width: '1px', height: 4, bgcolor: 'divider', mx: t === 0 ? 0 : 'auto', mb: '1px' },
          }}>
            {clock(t, 0)}
          </Box>
        ))}
      </Box>
    </Box>
  );
}
