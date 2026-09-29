import { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight, Table2, Hash } from 'lucide-react';
import { formatNumber } from '../lib/utils';

export default function SchemaPanel({ databaseName, dbType, tables, sessionId }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (sessionId) setOpen(true);
  }, [sessionId]);

  const dbTypeIcon:  = {
    postgresql: '🐘',
    mysql: '🐬',
    sqlite: '◈',
  };

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <button
        id="schema-panel-toggle"
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: '0.625rem',
          padding: '0.875rem 1rem',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--color-text-primary)',
        }}
      >
        {open ? <ChevronDown size={14} color="var(--color-text-muted)" /> : <ChevronRight size={14} color="var(--color-text-muted)" />}
        <span style={{ fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-secondary)' }}>
          Data model
        </span>
        <span style={{ fontSize: '0.75rem', marginLeft: 'auto', color: 'var(--color-text-muted)' }}>
          {dbTypeIcon[dbType] ?? '◈'} {databaseName} · {tables.length} entities
        </span>
      </button>

      {open && (
        <div style={{
          borderTop: '1px solid var(--color-border-subtle)',
          maxHeight: 260,
          overflowY: 'auto',
          padding: '0.375rem 0',
        }}>
          {tables.map(t => (
            <div
              key={t.table}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.375rem 1rem',
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(139,92,246,.06)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <Table2 size={12} color="var(--color-accent)" />
              <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-primary)', flex: 1 }}>
                {t.table}
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
                <Hash size={9} />
                {t.row_count >= 0 ? formatNumber(t.row_count) : '—'} rows
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
