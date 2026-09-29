// src/components/DataTable.jsx — sortable, paginated results table
import { useState, useMemo } from 'react';
import { ChevronUp, ChevronDown, ChevronsUpDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { formatNumber } from '../lib/utils';


function cellDisplay(v) {
  if (v === null || v === undefined) return '—';
  return String(v);
}

export default function DataTable({ columns, rows, rowCount, pageSize = 25 }) {
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState(null);
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    if (sortCol === null || sortDir === null) return rows;
    return [...rows].sort((a, b) => {
      const av = a[sortCol];
      const bv = b[sortCol];
      if (av === null) return 1;
      if (bv === null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') {
        return sortDir === 'asc' ? av - bv : bv - av;
      }
      return sortDir === 'asc'
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
  }, [rows, sortCol, sortDir]);

  const totalPages = Math.ceil(sorted.length / pageSize);
  const pageRows = sorted.slice(page * pageSize, (page + 1) * pageSize);

  const handleSort = (colIndex) => {
    if (sortCol !== colIndex) {
      setSortCol(colIndex);
      setSortDir('asc');
    } else if (sortDir === 'asc') {
      setSortDir('desc');
    } else if (sortDir === 'desc') {
      setSortCol(null);
      setSortDir(null);
    } else {
      setSortDir('asc');
    }
    setPage(0);
  };

  return (
    <div>
      {/* Table */}
      <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid var(--color-border)' }}>
        <table className="data-table">
          <thead>
            <tr>
              {columns.map((col, i) => (
                <th
                  key={col}
                  className={sortCol === i ? 'sorted' : ''}
                  onClick={() => handleSort(i)}
                  id={`sort-col-${i}`}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                    {col}
                    {sortCol === i && sortDir === 'asc' && <ChevronUp size={10} />}
                    {sortCol === i && sortDir === 'desc' && <ChevronDown size={10} />}
                    {sortCol !== i && <ChevronsUpDown size={10} style={{ opacity: 0.3 }} />}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => (
                  <td key={ci} title={cellDisplay(cell)}>
                    {cellDisplay(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: '0.75rem',
        fontSize: '0.75rem',
        color: 'var(--color-text-muted)',
      }}>
        <span>
          {formatNumber(rows.length)} row{rows.length !== 1 ? 's' : ''} displayed
          {rowCount > rows.length && ` (${formatNumber(rowCount)} total — results capped)`}
        </span>

        {totalPages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <button
              id="table-prev-btn"
              className="btn btn-ghost"
              style={{ padding: '0.2rem 0.4rem', height: 'auto' }}
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
            >
              <ChevronLeft size={13} />
            </button>
            <span>Page {page + 1} / {totalPages}</span>
            <button
              id="table-next-btn"
              className="btn btn-ghost"
              style={{ padding: '0.2rem 0.4rem', height: 'auto' }}
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page === totalPages - 1}
            >
              <ChevronRight size={13} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
