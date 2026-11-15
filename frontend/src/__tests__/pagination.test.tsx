import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { usePagination } from '../shared/usePagination';

function List({ count }: { count: number }) {
  const rows = Array.from({ length: count }, (_, i) => `Row ${i + 1}`);
  const { pageRows, pager } = usePagination(rows, 'Rows');
  return <div><ul>{pageRows.map((r) => <li key={r}>{r}</li>)}</ul>{pager}</div>;
}

describe('pagination', () => {
  it('shows ten rows at a time and pages forward', async () => {
    render(<List count={23} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(10);
    expect(screen.getByText('1–10 of 23')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Go to next page' }));
    expect(screen.getByText('Row 11')).toBeInTheDocument();
    expect(screen.queryByText('Row 1')).not.toBeInTheDocument();
  });

  it('shows no pager for a single page', () => {
    render(<List count={4} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    expect(screen.queryByRole('button', { name: 'Go to next page' })).not.toBeInTheDocument();
  });
});
