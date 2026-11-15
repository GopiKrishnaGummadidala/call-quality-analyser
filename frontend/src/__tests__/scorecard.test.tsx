import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CallScorecardEditor, CHECKS, validateCallScorecard } from '../task-editors/call-scorecard/CallScorecardEditor';
import type { CallScorecardPayload } from '../task-editors/call-scorecard/CallScorecardEditor';

const input = { callTitle: 'Mortgage rate follow-up', transcript: [{ speaker: 'AGENT' as const, text: 'Your rate ends next month.' }] };
const allPass = Object.fromEntries(CHECKS.map((c) => [c.key, 'PASS'])) as CallScorecardPayload['checks'];

function Harness({ initial, errors = [] }: { initial: CallScorecardPayload; errors?: string[] }) {
  const [payload, setPayload] = useState(initial);
  return <><CallScorecardEditor payload={payload} input={input} readOnly={false} onChange={setPayload} errors={errors} />
    <output data-testid="state">{JSON.stringify(payload)}</output></>;
}

describe('QA scorecard', () => {
  it('uses the same rules as the server', () => {
    expect(validateCallScorecard({ checks: {}, outcome: null, notes: '' }))
      .toEqual([`Answer every check (${CHECKS.length} still open)`, 'Choose an overall outcome']);
    expect(validateCallScorecard({ checks: { ...allPass, NO_PRESSURE_SELLING: 'FAIL' }, outcome: 'COMPLIANT', notes: '' }))
      .toEqual(['Notes are required when a check fails', 'A call with a failed check cannot be compliant']);
    expect(validateCallScorecard({ checks: allPass, outcome: 'COMPLIANT', notes: '' })).toEqual([]);
  });

  it('records a result per check and the outcome', async () => {
    render(<Harness initial={{ checks: {}, outcome: null, notes: '' }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Identity verified: fail' }));
    await userEvent.click(screen.getByRole('radio', { name: /Breach/ }));
    const state = JSON.parse(screen.getByTestId('state').textContent!);
    expect(state.checks.IDENTITY_VERIFIED).toBe('FAIL');
    expect(state.outcome).toBe('BREACH');
  });

  it('marks the outcome and notes red with the reason', () => {
    render(<Harness initial={{ checks: { ...allPass, NO_PRESSURE_SELLING: 'FAIL' }, outcome: 'COMPLIANT', notes: '' }}
      errors={['Notes are required when a check fails', 'A call with a failed check cannot be compliant']} />);
    expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('radio', { name: /Compliant/ })).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('A call with a failed check cannot be compliant')).toBeInTheDocument();
  });
});
