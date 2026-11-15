import { Box, Card, Chip, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import VerifiedIcon from '@mui/icons-material/VerifiedOutlined';
import SchoolIcon from '@mui/icons-material/SchoolOutlined';
import GppBadIcon from '@mui/icons-material/GppBadOutlined';
import type { ReactNode } from 'react';
import type { EditorProps } from '../registry';
import { SPEAKER_COLOR, SPEAKER_NAME } from '../../app/theme';

export type CheckResult = 'PASS' | 'FAIL' | 'NOT_APPLICABLE';
export type Outcome = 'COMPLIANT' | 'NEEDS_COACHING' | 'BREACH';
export type CheckKey =
  | 'IDENTITY_VERIFIED' | 'PURPOSE_STATED' | 'AFFORDABILITY_CHECKED' | 'COSTS_DISCLOSED'
  | 'WITHDRAWAL_RIGHTS_EXPLAINED' | 'NO_PRESSURE_SELLING' | 'NEXT_STEPS_CONFIRMED';

export interface CallScorecardPayload {
  checks: Partial<Record<CheckKey, CheckResult | null>>;
  outcome: Outcome | null;
  notes: string;
}
export interface CallScorecardInput {
  callTitle: string;
  transcript: { speaker: keyof typeof SPEAKER_NAME; text: string }[];
}

/** The conduct checks, in the order a call normally runs. Same keys and rules as the server (CallScorecardTaskType). */
export const CHECKS: { key: CheckKey; label: string; hint: string }[] = [
  { key: 'IDENTITY_VERIFIED', label: 'Identity verified', hint: 'Customer identified before any account details were shared' },
  { key: 'PURPOSE_STATED', label: 'Purpose of the call stated', hint: 'The customer knows why the bank is calling' },
  { key: 'AFFORDABILITY_CHECKED', label: 'Affordability checked', hint: 'Income, outgoings and existing credit asked before lending' },
  { key: 'COSTS_DISCLOSED', label: 'Costs disclosed', hint: 'Rate, fees and total cost explained clearly' },
  { key: 'WITHDRAWAL_RIGHTS_EXPLAINED', label: 'Right to withdraw explained', hint: 'Cooling-off period mentioned for new credit' },
  { key: 'NO_PRESSURE_SELLING', label: 'No pressure selling', hint: 'No artificial deadlines or pushing' },
  { key: 'NEXT_STEPS_CONFIRMED', label: 'Next steps confirmed', hint: 'What happens next, and when, was agreed' },
];

const OUTCOMES: { value: Outcome; label: string; hint: string; icon: ReactNode; color: string }[] = [
  { value: 'COMPLIANT', label: 'Compliant', hint: 'No issues', icon: <VerifiedIcon />, color: '#16a34a' },
  { value: 'NEEDS_COACHING', label: 'Needs coaching', hint: 'Minor gaps to train on', icon: <SchoolIcon />, color: '#d97706' },
  { value: 'BREACH', label: 'Breach', hint: 'A conduct rule was broken', icon: <GppBadIcon />, color: '#dc2626' },
];

const RESULT_COLOR: Record<CheckResult, 'success' | 'error' | 'standard'> = { PASS: 'success', FAIL: 'error', NOT_APPLICABLE: 'standard' };

/** Same messages as the server, so a field is marked red with the server's own words. */
export function validateCallScorecard(payload: CallScorecardPayload): string[] {
  const errors: string[] = [];
  const open = CHECKS.filter((c) => !payload.checks[c.key]).length;
  if (open > 0) errors.push(`Answer every check (${open} still open)`);
  if (!payload.outcome) errors.push('Choose an overall outcome');
  const failed = CHECKS.some((c) => payload.checks[c.key] === 'FAIL');
  if (failed && !payload.notes.trim()) errors.push('Notes are required when a check fails');
  if (failed && payload.outcome === 'COMPLIANT') errors.push('A call with a failed check cannot be compliant');
  return errors;
}

export function CallScorecardEditor({
  payload, input, onChange, readOnly, errors = [],
}: EditorProps<CallScorecardPayload, CallScorecardInput>) {
  const checksError = errors.find((e) => /every check/i.test(e));
  const outcomeError = errors.find((e) => /outcome|cannot be compliant/i.test(e));
  const notesError = errors.find((e) => /notes are required/i.test(e));
  const setCheck = (key: CheckKey, value: CheckResult | null) =>
    onChange({ ...payload, checks: { ...payload.checks, [key]: value } });

  return (
    <Stack spacing={2.5} data-testid="call-scorecard-editor">
      <Card sx={{ p: { xs: 2, md: 3 } }} component="section" aria-labelledby="call-transcript-title">
        <Typography variant="overline" color="text.secondary">Call being scored</Typography>
        <Typography variant="h2" id="call-transcript-title" sx={{ mb: 1.5 }}>{input.callTitle}</Typography>
        <Stack spacing={1.25} component="ol" sx={{ listStyle: 'none', p: 0, m: 0 }} aria-label="Call transcript">
          {input.transcript.map((line, i) => (
            <Stack key={i} component="li" direction="row" spacing={1.5} alignItems="flex-start">
              <Chip size="small" label={SPEAKER_NAME[line.speaker] ?? line.speaker}
                sx={{ minWidth: 86, fontWeight: 650, color: SPEAKER_COLOR[line.speaker], bgcolor: `${SPEAKER_COLOR[line.speaker]}1a` }} />
              <Typography sx={{ fontSize: 15, lineHeight: 1.55 }}>{line.text}</Typography>
            </Stack>
          ))}
        </Stack>
      </Card>

      <Card sx={{ p: { xs: 2, md: 3 } }} component="fieldset" disabled={readOnly}
        aria-invalid={checksError ? true : undefined}>
        <Typography component="legend" variant="h2" sx={{ color: checksError ? 'error.main' : undefined }}>Conduct checks</Typography>
        <Stack divider={<Box sx={{ borderTop: 1, borderColor: 'divider' }} />} sx={{ mt: 1.5 }}>
          {CHECKS.map((c) => {
            const value = payload.checks[c.key] ?? null;
            const missing = !!checksError && !value;
            return (
              <Stack key={c.key} direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }}
                sx={{ py: 1.25, px: 1, borderRadius: 2, outline: missing ? '2px solid' : 'none', outlineColor: 'error.main' }}>
                <Box sx={{ flex: 1 }}>
                  <Typography sx={{ fontWeight: 650 }} id={`check-${c.key}`}>{c.label}</Typography>
                  <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>{c.hint}</Typography>
                </Box>
                <ToggleButtonGroup exclusive size="small" value={value} disabled={readOnly}
                  aria-labelledby={`check-${c.key}`} onChange={(_, v: CheckResult | null) => setCheck(c.key, v)}>
                  {(['PASS', 'FAIL', 'NOT_APPLICABLE'] as const).map((r) => (
                    <ToggleButton key={r} value={r} color={RESULT_COLOR[r]} sx={{ px: 1.75, fontWeight: 650 }}
                      aria-label={`${c.label}: ${r === 'NOT_APPLICABLE' ? 'not applicable' : r.toLowerCase()}`}>
                      {r === 'NOT_APPLICABLE' ? 'N/A' : r === 'PASS' ? 'Pass' : 'Fail'}
                    </ToggleButton>
                  ))}
                </ToggleButtonGroup>
              </Stack>
            );
          })}
        </Stack>
        {checksError && <Typography sx={{ color: 'error.main', fontSize: 12.5, mt: 1 }}>{checksError}</Typography>}
      </Card>

      <Card sx={{ p: { xs: 2, md: 3 } }} component="fieldset" disabled={readOnly}>
        <Typography component="legend" variant="h2" sx={{ mb: 1.5, color: outcomeError ? 'error.main' : undefined }}>Overall outcome</Typography>
        <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' } }} role="radiogroup" aria-label="Overall outcome">
          {OUTCOMES.map((o) => {
            const checked = payload.outcome === o.value;
            return (
              <Box key={o.value} component="label" sx={{
                display: 'flex', alignItems: 'center', gap: 1.5, p: 1.5, borderRadius: 3, cursor: readOnly ? 'default' : 'pointer',
                border: 2, borderColor: checked ? o.color : outcomeError ? 'error.main' : 'divider', bgcolor: checked ? `${o.color}12` : 'transparent',
              }}>
                <input type="radio" name="outcome" value={o.value} checked={checked} disabled={readOnly}
                  aria-invalid={outcomeError ? true : undefined}
                  onChange={() => onChange({ ...payload, outcome: o.value })} style={{ accentColor: o.color }} />
                <Box sx={{ color: o.color, display: 'grid' }}>{o.icon}</Box>
                <Box>
                  <Typography sx={{ fontWeight: 650 }}>{o.label}</Typography>
                  <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>{o.hint}</Typography>
                </Box>
              </Box>
            );
          })}
        </Box>
        {outcomeError && <Typography sx={{ color: 'error.main', fontSize: 12.5, mt: 1 }}>{outcomeError}</Typography>}
      </Card>

      <TextField label="Notes" multiline minRows={3} fullWidth value={payload.notes} error={!!notesError}
        helperText={notesError ?? 'Required when a check fails: what went wrong, with the moment in the call'}
        inputProps={{ readOnly }} onChange={(e) => onChange({ ...payload, notes: e.target.value })} />
    </Stack>
  );
}
