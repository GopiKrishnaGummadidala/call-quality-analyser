import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Accordion, AccordionDetails, AccordionSummary, Alert, Box, Card, Chip, Skeleton, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Tooltip, Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import InsightsIcon from '@mui/icons-material/Insights';
import DatasetIcon from '@mui/icons-material/DatasetOutlined';
import FunctionsIcon from '@mui/icons-material/Functions';
import ScienceIcon from '@mui/icons-material/ScienceOutlined';
import { api } from '../../shared/api';
import { useActiveProject } from '../../shared/useActiveProject';
import type { DraftCorrections, ModelResult } from '../../shared/types';
import SmartToyIcon from '@mui/icons-material/SmartToyOutlined';

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const MODEL_COLORS = ['#6366f1', '#14b8a6', '#f97316', '#ec4899'];
const ERR = [
  { key: 'substitutions', label: 'Substitutions', color: '#6366f1' },
  { key: 'deletions', label: 'Deletions', color: '#f59e0b' },
  { key: 'insertions', label: 'Insertions', color: '#ec4899' },
] as const;

/** Small horizontal bar, used inline in tables (like a sparkline). */
function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  return (
    <Box sx={{ width: 90, height: 8, borderRadius: 9, bgcolor: 'action.hover', overflow: 'hidden' }}>
      <Box sx={{ width: `${max > 0 ? Math.min(100, (value / max) * 100) : 0}%`, height: '100%', bgcolor: color, borderRadius: 9 }} />
    </Box>
  );
}

function ModelCard({ m, color }: { m: ModelResult; color: string }) {
  const errors = m.substitutions + m.deletions + m.insertions;
  return (
    <Card sx={{ p: 2.5, flex: '1 1 300px', position: 'relative', overflow: 'hidden' }}>
      <Box sx={{ position: 'absolute', inset: 0, height: 4, bgcolor: color }} />
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
        <Box>
          <Typography sx={{ fontWeight: 700 }}>{m.modelName}</Typography>
          <Chip size="small" label={m.modelVersion} sx={{ mt: 0.5, height: 20, fontSize: 11, fontWeight: 700, bgcolor: `${color}1f`, color }} />
        </Box>
        <Box sx={{ textAlign: 'right' }}>
          <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: 'text.secondary' }}>WER</Typography>
          <Typography sx={{ fontSize: 38, fontWeight: 800, lineHeight: 1, color, fontVariantNumeric: 'tabular-nums' }}>{pct(m.wer)}</Typography>
        </Box>
      </Stack>

      <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 2, mb: 0.75 }}>
        {errors} word errors over {m.referenceWords} reference words
      </Typography>
      <Stack direction="row" sx={{ height: 10, borderRadius: 9, overflow: 'hidden', bgcolor: 'action.hover' }}>
        {ERR.map((e) => (m[e.key] > 0 ? (
          <Tooltip key={e.key} title={`${e.label}: ${m[e.key]}`}>
            <Box sx={{ width: `${(m[e.key] / Math.max(m.referenceWords, 1)) * 100}%`, bgcolor: e.color }} />
          </Tooltip>
        ) : null))}
      </Stack>
      <Stack direction="row" spacing={2} sx={{ mt: 1.5 }}>
        {ERR.map((e) => (
          <Stack key={e.key} spacing={0}>
            <Stack direction="row" spacing={0.75} alignItems="center">
              <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: e.color }} />
              <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{e.label}</Typography>
            </Stack>
            <Typography sx={{ fontWeight: 700, fontSize: 18, pl: 2 }}>{m[e.key]}</Typography>
          </Stack>
        ))}
      </Stack>
    </Card>
  );
}

function Fact({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <Stack direction="row" spacing={1.5} alignItems="center" sx={{ minWidth: 180 }}>
      <Box sx={{ width: 36, height: 36, borderRadius: 2.5, display: 'grid', placeItems: 'center', bgcolor: 'action.hover', color: 'secondary.main' }}>{icon}</Box>
      <Box>
        <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{label}</Typography>
        <Typography sx={{ fontWeight: 650, fontSize: 14 }}>{value}</Typography>
      </Box>
    </Stack>
  );
}

function DraftCorrectionsCard({ c }: { c: DraftCorrections }) {
  const color = '#4f5bd5';
  const maxWer = Math.max(0.01, ...c.tasks.map((t) => t.wer));
  return (
    <Card component="section" aria-labelledby="draft-title" sx={{ overflow: 'hidden', borderColor: 'primary.main' }}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ p: 2.5 }} alignItems={{ md: 'center' }}>
        <Box sx={{ flex: 1 }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <SmartToyIcon color="primary" />
            <Typography variant="h2" id="draft-title">Draft model in production</Typography>
            <Chip size="small" label={c.modelName} color="primary" variant="outlined" sx={{ fontWeight: 650 }} />
          </Stack>
          <Typography sx={{ fontSize: 13.5, color: 'text.secondary', mt: 0.75, maxWidth: 640 }}>
            Real model output (first drafts annotators correct), compared with the transcripts reviewers approved:
            the share of words humans had to change. It grows with every approval.
          </Typography>
        </Box>
        {c.approvedTasks > 0 && (
          <Stack direction="row" spacing={3}>
            <Box sx={{ textAlign: 'right' }}>
              <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: 'text.secondary' }}>WORDS CORRECTED</Typography>
              <Typography sx={{ fontSize: 34, fontWeight: 800, lineHeight: 1, color, fontVariantNumeric: 'tabular-nums' }}>{pct(c.wer)}</Typography>
            </Box>
            <Box sx={{ textAlign: 'right' }}>
              <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: 'text.secondary' }}>SEGMENTS ACCEPTED AS IS</Typography>
              <Typography sx={{ fontSize: 34, fontWeight: 800, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                {c.segmentsUnchanged}<Box component="span" sx={{ fontSize: 18, color: 'text.secondary' }}> / {c.segments}</Box>
              </Typography>
            </Box>
          </Stack>
        )}
      </Stack>
      {c.approvedTasks === 0 ? (
        <Typography sx={{ px: 2.5, pb: 2.5, fontSize: 14, color: 'text.secondary' }}>
          No drafted task has been approved yet; numbers appear with the first approval.
        </Typography>
      ) : (
        <TableContainer>
          <Table size="small" aria-label="Draft corrections" sx={{ minWidth: 560 }}>
            <TableHead>
              <TableRow sx={{ bgcolor: 'action.hover' }}>
                <TableCell>Approved task</TableCell><TableCell align="right">Segments edited</TableCell>
                <TableCell align="right">Words</TableCell><TableCell>Words corrected</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {c.tasks.map((t) => (
                <TableRow key={t.taskId}>
                  <TableCell sx={{ fontSize: 13.5 }}>{t.title}</TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{t.segmentsEdited} / {t.segments}</TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{t.referenceWords}</TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Bar value={t.wer} max={maxWer} color={color} />
                      <Typography sx={{ fontSize: 13, fontWeight: 650, fontVariantNumeric: 'tabular-nums' }}>{pct(t.wer)}</Typography>
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Typography sx={{ px: 2.5, py: 1.5, fontSize: 12, color: 'text.secondary' }}>
            {c.substitutions} substitutions, {c.deletions} deletions, {c.insertions} insertions over {c.referenceWords} approved words.
            Style differences (for example "10" vs "ten") count as corrections; a style guide or number normalisation
            would separate them from real recognition errors. {c.modelVersion}.
          </Typography>
        </TableContainer>
      )}
    </Card>
  );
}

export function EvaluationPage() {
  const { active } = useActiveProject();
  const { data, isLoading, error } = useQuery({
    queryKey: ['evaluation', active?.id],
    queryFn: () => api.evaluation(active!.id),
    enabled: !!active,
  });

  if (isLoading || !active) return <Stack spacing={2}><Skeleton variant="rounded" height={60} /><Skeleton variant="rounded" height={220} /></Stack>;
  if (error || !data) return <Alert severity="error" role="alert">Could not load evaluation.</Alert>;

  const maxClipWer = Math.max(0.01, ...data.models.flatMap((m) => m.clips.map((c) => c.wer)));

  return (
    <Stack component="section" aria-labelledby="eval-title" spacing={3}>
      <Box>
        <Typography variant="overline" color="secondary.main">{active.name}</Typography>
        <Stack direction="row" spacing={1.25} alignItems="center">
          <InsightsIcon color="primary" />
          <Typography variant="h1" id="eval-title">Model evaluation</Typography>
        </Stack>
      </Box>

      <Alert severity="warning" role="note" variant="outlined">{data.disclaimer}</Alert>

      <Card sx={{ p: 2.5 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={3} flexWrap="wrap" useFlexGap>
          <Fact icon={<FunctionsIcon />} label="Metric" value={data.metric} />
          <Fact icon={<DatasetIcon />} label="Dataset" value={data.datasetName} />
          <Fact icon={<ScienceIcon />} label="Size" value={`${data.datasetSize} clips · ${data.totalReferenceWords} reference words`} />
        </Stack>
        <Typography sx={{ mt: 2, fontSize: 13.5, color: 'text.secondary', borderTop: 1, borderColor: 'divider', pt: 2 }}>
          {data.metricDefinition}
        </Typography>
      </Card>

      <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
        {data.models.map((m, i) => <ModelCard key={m.modelName} m={m} color={MODEL_COLORS[i % MODEL_COLORS.length]} />)}
      </Stack>

      {data.draftCorrections && <DraftCorrectionsCard c={data.draftCorrections} />}

      <Box>
        <Typography variant="h2" sx={{ mb: 1.5 }}>Per-clip results and provenance</Typography>
        {data.models.map((m, i) => {
          const color = MODEL_COLORS[i % MODEL_COLORS.length];
          return (
            <Accordion key={m.modelName} disableGutters variant="outlined"
              sx={{ borderRadius: '14px !important', mb: 1.5, '&::before': { display: 'none' }, overflow: 'hidden' }}>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Stack direction="row" spacing={1.5} alignItems="center">
                  <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: color }} />
                  <Typography sx={{ fontWeight: 650 }}>{m.modelName}: per-clip results and provenance</Typography>
                </Stack>
              </AccordionSummary>
              <AccordionDetails sx={{ p: 0 }}>
                <Typography sx={{ px: 2, pb: 1.5, fontSize: 13, color: 'text.secondary' }}>{m.provenance}</Typography>
                <TableContainer>
                  <Table size="small" sx={{ minWidth: 640 }}>
                    <TableHead>
                      <TableRow sx={{ bgcolor: 'action.hover' }}>
                        <TableCell>Clip</TableCell><TableCell>Reference</TableCell><TableCell>Hypothesis</TableCell><TableCell>WER</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {m.clips.map((c) => (
                        <TableRow key={c.clipId}>
                          <TableCell sx={{ fontFamily: 'ui-monospace, monospace', fontSize: 12.5 }}>{c.clipId}</TableCell>
                          <TableCell sx={{ fontSize: 13.5 }}>{c.reference}</TableCell>
                          <TableCell sx={{ fontSize: 13.5 }}>{c.hypothesis}</TableCell>
                          <TableCell>
                            <Stack direction="row" spacing={1} alignItems="center">
                              <Bar value={c.wer} max={maxClipWer} color={color} />
                              <Typography sx={{ fontSize: 13, fontWeight: 650, fontVariantNumeric: 'tabular-nums' }}>{pct(c.wer)}</Typography>
                            </Stack>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </AccordionDetails>
            </Accordion>
          );
        })}
      </Box>
    </Stack>
  );
}
