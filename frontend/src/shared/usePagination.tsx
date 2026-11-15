import { useState } from 'react';
import { TablePagination } from '@mui/material';

export const PAGE_SIZES = [10, 25, 50];

/**
 * Client-side paging for lists the server already returns newest first (access log, account changes, accounts).
 * Returns the rows of the current page and the MUI pager to render under the table (none for a single page).
 */
export function usePagination<T>(rows: T[], label: string, initialSize = 10) {
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(initialSize);
  const lastPage = Math.max(0, Math.ceil(rows.length / size) - 1);
  const current = Math.min(page, lastPage); // stay on a real page when the list shrinks
  const pageRows = rows.slice(current * size, current * size + size);
  const pager = rows.length > PAGE_SIZES[0] ? (
    <TablePagination component="div" count={rows.length} page={current} rowsPerPage={size} rowsPerPageOptions={PAGE_SIZES}
      onPageChange={(_, p) => setPage(p)} onRowsPerPageChange={(e) => { setSize(Number(e.target.value)); setPage(0); }}
      labelRowsPerPage="Rows per page" aria-label={`${label} pages`} sx={{ borderTop: 1, borderColor: 'divider' }} />
  ) : null;
  return { pageRows, pager };
}
