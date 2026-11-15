import { useEffect, useRef, useState } from 'react';
import {
  Avatar, Box, Button, Card, Chip, Divider, IconButton, MenuItem, Stack, TextField, ToggleButton, ToggleButtonGroup,
  Tooltip, Typography,
} from '@mui/material';
import PlayArrowRounded from '@mui/icons-material/PlayArrowRounded';
import PauseRounded from '@mui/icons-material/PauseRounded';
import Replay5Icon from '@mui/icons-material/Replay5';
import Forward5Icon from '@mui/icons-material/Forward5';
import SkipPreviousRounded from '@mui/icons-material/SkipPreviousRounded';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline';
import WarningAmberIcon from '@mui/icons-material/WarningAmberRounded';
import SmartToyIcon from '@mui/icons-material/SmartToyOutlined';
import EditIcon from '@mui/icons-material/EditOutlined';
import type { EditorProps } from '../registry';
import { useShortcuts } from '../../shared/shortcuts';
import { clock } from '../../shared/format';
import { LABEL_COLOR, SPEAKER_COLOR, SPEAKER_NAME } from '../../app/theme';
import { assignLanes } from './timeline';
import { LABELS, SPEAKERS } from './types';
import type { Segment, TranscriptionInput, TranscriptionPayload } from './types';
import { useAudioClip } from './useAudioClip';
import { segmentFieldErrors } from '../fieldErrors';
import { Waveform } from './Waveform';

const BINS = 220;
const RATES = [0.75, 1, 1.5];
const secs = (ms: number) => (ms / 1000).toFixed(2);
const toMs = (s: string) => Math.max(0, Math.round(parseFloat(s || '0') * 1000));

export function TranscriptionEditor({
  payload, input, onChange, readOnly, errors = [], draft = null,
}: EditorProps<TranscriptionPayload, TranscriptionInput>) {
  const audio = useRef<HTMLAudioElement>(null);
  const stopAt = useRef<number | null>(null);
  const [currentMs, setCurrentMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const clip = useAudioClip(input.audioUrl, BINS);
  const { peaks } = clip;
  const { segments } = payload;
  const lanes = assignLanes(segments);
  const activeIndex = segments.findIndex((s) => currentMs >= s.startMs && currentMs < s.endMs);
  const overlapping = new Set(lanes.flatMap((l, i) => (l > 0 ? [i] : [])));
  const fieldErrors = segmentFieldErrors(errors);
  const needsSegments = errors.some((e) => /at least one segment/i.test(e));
  // Model-assisted annotation: segments start from the model's draft; track which ones a human has corrected.
  const draftById = new Map((draft?.segments ?? []).filter((d) => d.text.trim() !== '').map((d) => [d.id, d.text]));
  const untouched = segments.filter((s) => draftById.get(s.id)?.trim() === s.text.trim()).length;

  // Smooth playhead while playing; also honours "play this segment only".
  useEffect(() => {
    if (!playing) return undefined;
    let raf = 0;
    const tick = () => {
      const el = audio.current;
      if (el) {
        const ms = el.currentTime * 1000;
        if (stopAt.current !== null && ms >= stopAt.current) { el.pause(); stopAt.current = null; }
        setCurrentMs(ms);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  useEffect(() => { if (audio.current) audio.current.playbackRate = rate; }, [rate]);

  const update = (index: number, patch: Partial<Segment>) =>
    onChange({ segments: segments.map((s, i) => (i === index ? { ...s, ...patch } : s)) });

  const remove = (index: number) => onChange({ segments: segments.filter((_, i) => i !== index) });

  const add = () => {
    const now = Math.round((audio.current?.currentTime ?? 0) * 1000);
    const start = Math.min(now, Math.max(0, input.durationMs - 500));
    const end = Math.min(start + 2000, input.durationMs);
    const id = `s${Date.now().toString(36)}${segments.length}`;
    onChange({ segments: [...segments, { id, startMs: start, endMs: end, speaker: 'AGENT', label: 'CLEAR', text: '' }] });
  };

  const seek = (ms: number) => {
    const clamped = Math.min(Math.max(ms, 0), input.durationMs);
    stopAt.current = null;
    if (audio.current) audio.current.currentTime = clamped / 1000;
    setCurrentMs(clamped);
  };

  const togglePlay = () => {
    const el = audio.current;
    if (!el) return;
    stopAt.current = null;
    if (el.paused) void el.play()?.catch(() => undefined); else el.pause();
  };

  const playSegment = (s: Segment) => {
    const el = audio.current;
    if (!el) return;
    el.currentTime = s.startMs / 1000;
    setCurrentMs(s.startMs);
    stopAt.current = s.endMs;
    void el.play()?.catch(() => undefined);
  };

  // Shortcuts that would conflict with typing are NOT allowed while an input is focused.
  useShortcuts([
    { key: 'k', handler: togglePlay },
    { key: 'n', handler: add },
  ], !readOnly);

  return (
    <Card data-testid="transcription-editor" sx={{ overflow: 'visible' }}>
      <audio ref={audio} src={clip.src} preload="metadata" aria-label="Task audio"
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); stopAt.current = null; }}
        onTimeUpdate={(e) => { if (!playing) setCurrentMs(e.currentTarget.currentTime * 1000); }} />

      {/* header: file + legend */}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} justifyContent="space-between"
        alignItems={{ sm: 'center' }} sx={{ px: 2.5, pt: 2, pb: 1.5 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontWeight: 700, fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 14.5 }} noWrap>
            {input.audioName ?? 'Recording'}
          </Typography>
          <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>
            {clip.status === 'loading' && 'Loading recording… · '}
            {clip.status === 'error' && 'Recording unavailable · '}
            {clock(input.durationMs)} · {segments.length} segment{segments.length === 1 ? '' : 's'}
            {overlapping.size > 0 && ` · ${overlapping.size} overlapping`}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
          {SPEAKERS.map((sp) => (
            <Stack key={sp} direction="row" spacing={0.75} alignItems="center">
              <Box sx={{ width: 10, height: 10, borderRadius: 1, bgcolor: SPEAKER_COLOR[sp] }} />
              <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>{SPEAKER_NAME[sp]}</Typography>
            </Stack>
          ))}
        </Stack>
      </Stack>

      <Box sx={{ px: 2.5 }}>
        <Waveform peaks={peaks} bins={BINS} durationMs={input.durationMs} segments={segments} lanes={lanes}
          currentMs={currentMs} activeIndex={activeIndex} onSeek={seek} onJump={(i) => playSegment(segments[i])} />
      </Box>

      {/* transport */}
      <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap
        sx={{ px: 2.5, py: 1.5, borderTop: 1, borderBottom: 1, borderColor: 'divider', mt: 1, bgcolor: 'action.hover' }}>
        <Tooltip title="Back to start"><IconButton aria-label="Back to start" onClick={() => seek(0)}><SkipPreviousRounded /></IconButton></Tooltip>
        <Tooltip title="Back 5 seconds"><IconButton aria-label="Back 5 seconds" onClick={() => seek(currentMs - 5000)}><Replay5Icon /></IconButton></Tooltip>
        <Tooltip title={playing ? 'Pause (K)' : 'Play (K)'}>
          <IconButton aria-label={playing ? 'Pause' : 'Play'} onClick={togglePlay}
            sx={{ bgcolor: 'primary.main', color: 'primary.contrastText', width: 46, height: 46,
              boxShadow: '0 6px 16px color-mix(in srgb, var(--mui-palette-primary-main) 40%, transparent)',
              '&:hover': { bgcolor: 'primary.dark' } }}>
            {playing ? <PauseRounded /> : <PlayArrowRounded />}
          </IconButton>
        </Tooltip>
        <Tooltip title="Forward 5 seconds"><IconButton aria-label="Forward 5 seconds" onClick={() => seek(currentMs + 5000)}><Forward5Icon /></IconButton></Tooltip>
        <Typography sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 650, fontSize: 14, mx: 1 }}>
          {clock(currentMs)} <Box component="span" sx={{ color: 'text.secondary', fontWeight: 500 }}>/ {clock(input.durationMs)}</Box>
        </Typography>
        <ToggleButtonGroup size="small" exclusive value={rate} onChange={(_, v: number | null) => v && setRate(v)} aria-label="Playback speed">
          {RATES.map((r) => <ToggleButton key={r} value={r} sx={{ px: 1.25, py: 0.25, fontSize: 12 }}>{r}×</ToggleButton>)}
        </ToggleButtonGroup>
        <Box sx={{ flex: 1 }} />
        {!readOnly && (
          <Button variant="outlined" startIcon={<AddIcon />} onClick={add} sx={{ borderRadius: 99 }}>
            Add segment at playhead (N)
          </Button>
        )}
      </Stack>

      {/* transcript */}
      <Box sx={{ px: 2.5, pt: 2, pb: 2.5 }}>
        <Stack direction="row" alignItems="baseline" justifyContent="space-between" sx={{ mb: 1.5 }}>
          <Typography variant="h2">Transcript</Typography>
          <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
            Overlapping segments are allowed (overlapping speech). Mark them as CROSSTALK.
          </Typography>
        </Stack>
        {draft && draftById.size > 0 && (
          <Stack direction="row" spacing={1.25} alignItems="center" aria-label="Model draft" sx={{
            mb: 1.5, px: 1.5, py: 1, borderRadius: 2, border: 1, borderColor: 'divider',
            bgcolor: 'color-mix(in srgb, var(--mui-palette-primary-main) 7%, transparent)',
          }}>
            <SmartToyIcon sx={{ color: 'primary.main' }} />
            <Typography sx={{ fontSize: 13.5, flex: 1 }}>
              First draft by <b>{draft.modelName}</b>. {readOnly ? 'Segments marked edited were corrected by the annotator.' : 'Listen to each segment and correct the text.'}
            </Typography>
            <Tooltip title={`${draft.modelVersion}. ${draft.provenance}`}>
              <Chip size="small" variant="outlined" color={untouched > 0 ? 'primary' : 'success'}
                label={`${untouched} of ${segments.length} unchanged`} sx={{ fontWeight: 650 }} />
            </Tooltip>
          </Stack>
        )}

        <Stack component="ol" spacing={1.5} sx={{ listStyle: 'none', p: 0, m: 0 }}>
          {segments.map((s, i) => {
            const n = i + 1;
            const c = SPEAKER_COLOR[s.speaker];
            const active = i === activeIndex;
            const fe = fieldErrors.get(i);
            const draftText = draftById.get(s.id);
            const unchanged = draftText !== undefined && draftText.trim() === s.text.trim();
            return (
              <Box component="li" key={s.id} sx={{
                position: 'relative', borderRadius: 3, border: fe ? 2 : 1, borderColor: fe ? 'error.main' : active ? c : 'divider',
                bgcolor: fe ? 'color-mix(in srgb, var(--mui-palette-error-main) 5%, transparent)' : active ? `${c}10` : 'background.paper', pl: 2.25, pr: 1.5, py: 1.5,
                transition: 'border-color .2s, background-color .2s',
                '&::before': { content: '""', position: 'absolute', left: 0, top: 10, bottom: 10, width: 4, borderRadius: 4, bgcolor: c },
              }}>
                <Stack direction="row" alignItems="center" spacing={1.25} flexWrap="wrap" useFlexGap>
                  <Avatar sx={{ width: 28, height: 28, fontSize: 13, fontWeight: 700, bgcolor: c }}>{n}</Avatar>
                  <Typography sx={{ fontWeight: 650, color: c, fontSize: 14 }}>{SPEAKER_NAME[s.speaker]}</Typography>
                  <Typography sx={{ fontSize: 13, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
                    {clock(s.startMs)} → {clock(s.endMs)} · {((s.endMs - s.startMs) / 1000).toFixed(1)}s
                  </Typography>
                  {overlapping.has(i) && <Chip size="small" label="overlap" sx={{ height: 20, fontSize: 11, bgcolor: `${LABEL_COLOR.CROSSTALK}1f`, color: LABEL_COLOR.CROSSTALK }} />}
                  {draftText !== undefined && (unchanged
                    ? <Chip size="small" icon={<SmartToyIcon />} label="model draft" color="primary" variant="outlined" sx={{ height: 22, fontSize: 11 }} />
                    : <Chip size="small" icon={<EditIcon />} label="edited" color="success" variant="outlined" sx={{ height: 22, fontSize: 11 }} />)}
                  {!readOnly && s.text.trim() === '' && (
                    <Chip size="small" icon={<WarningAmberIcon />} label="needs text" color={fe?.text ? 'error' : 'warning'} variant={fe?.text ? 'filled' : 'outlined'} sx={{ height: 22, fontSize: 11 }} />
                  )}
                  <Box sx={{ flex: 1 }} />
                  <Tooltip title="Play this segment">
                    <IconButton size="small" aria-label={`Play segment ${n}`} onClick={() => playSegment(s)} sx={{ color: c }}>
                      <PlayCircleOutlineIcon />
                    </IconButton>
                  </Tooltip>
                  {!readOnly && (
                    <Tooltip title="Delete segment">
                      <IconButton size="small" aria-label={`Delete segment ${n}`} onClick={() => remove(i)}>
                        <DeleteOutlineIcon />
                      </IconButton>
                    </Tooltip>
                  )}
                </Stack>

                <Stack direction="row" spacing={1.25} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 1.25 }}>
                  <ToggleButtonGroup size="small" exclusive value={s.speaker} disabled={readOnly} aria-label={`Segment ${n} speaker`}
                    onChange={(_, v: Segment['speaker'] | null) => v && update(i, { speaker: v })}>
                    {SPEAKERS.map((sp) => (
                      <ToggleButton key={sp} value={sp} sx={{
                        px: 1.25, py: 0.4, fontSize: 12.5,
                        '&.Mui-selected': { bgcolor: SPEAKER_COLOR[sp], color: '#fff', '&:hover': { bgcolor: SPEAKER_COLOR[sp] } },
                      }}>{SPEAKER_NAME[sp]}</ToggleButton>
                    ))}
                  </ToggleButtonGroup>
                  <TextField select size="small" label="Quality" value={s.label} disabled={readOnly} sx={{ width: 140 }}
                    onChange={(e) => update(i, { label: e.target.value as Segment['label'] })}
                    SelectProps={{ inputProps: { 'aria-label': `Segment ${n} label` } }}>
                    {LABELS.map((v) => (
                      <MenuItem key={v} value={v}>
                        <Box component="span" sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: LABEL_COLOR[v], mr: 1, display: 'inline-block' }} />
                        {v.charAt(0) + v.slice(1).toLowerCase()}
                      </MenuItem>
                    ))}
                  </TextField>
                  <Divider orientation="vertical" flexItem />
                  <TextField size="small" type="number" label="Start (s)" value={secs(s.startMs)} disabled={readOnly} sx={{ width: 108 }}
                    error={!!fe?.start} title={fe?.start}
                    inputProps={{ step: 0.1, min: 0, 'aria-label': `Segment ${n} start` }}
                    onChange={(e) => update(i, { startMs: toMs(e.target.value) })} />
                  <TextField size="small" type="number" label="End (s)" value={secs(s.endMs)} disabled={readOnly} sx={{ width: 108 }}
                    error={!!fe?.end} title={fe?.end}
                    inputProps={{ step: 0.1, min: 0, 'aria-label': `Segment ${n} end` }}
                    onChange={(e) => update(i, { endMs: toMs(e.target.value) })} />
                </Stack>
                {(fe?.start || fe?.end) && (
                  <Typography sx={{ color: 'error.main', fontSize: 12, mt: 0.5, ml: 0.25 }}>{fe.start ?? fe.end}</Typography>
                )}

                <TextField multiline minRows={2} fullWidth placeholder="Type what you hear…" value={s.text} sx={{ mt: 1.25 }}
                  inputProps={{ 'aria-label': `Segment ${n} text`, readOnly }}
                  error={!!fe?.text} helperText={fe?.text}
                  onChange={(e) => update(i, { text: e.target.value })} />
                {draftText !== undefined && !unchanged && (
                  <Typography sx={{ fontSize: 12.5, color: 'text.secondary', mt: 0.75 }} aria-label={`Segment ${n} model draft`}>
                    Model draft: <Box component="span" sx={{ fontStyle: 'italic' }}>{draftText}</Box>
                  </Typography>
                )}
              </Box>
            );
          })}
        </Stack>
        {segments.length === 0 && (
          <Typography sx={{ color: needsSegments ? 'error.main' : 'text.secondary', py: 3, textAlign: 'center' }}>
            No segments yet. Play the audio and press <b>N</b> to add one at the playhead.
          </Typography>
        )}
      </Box>
    </Card>
  );
}
