// src/components/ResponseCard.jsx — renders a single query result card
import { useState } from 'react';
import {
  ChevronDown, ChevronRight, Sparkles, Code2,
  AlertTriangle, Info, BarChart3, TableIcon, Clock,
} from 'lucide-react';
import DataTable from './DataTable';
import ResultChart from './ResultChart';
import { formatMs, formatNumber } from '../lib/utils';

export default function ResponseCard({ item }) {
  const { question, response } = item;
  const [sqlOpen, setSqlOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('table');

  const hasChart = !!response.chart_suggestion;
  const hasRows = response.columns.length > 0 && response.rows.length > 0;
  const isError = !!response.error;

  return (
    <div
      className="card animate-fade-in-up"
      style={{ overflow: 'hidden', marginBottom: '1rem' }}
    >
      {/* Question header */}
      <div style={{
        padding: '1rem 1.25rem',
        borderBottom: '1px solid var(--color-border-subtle)',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '0.75rem',
      }}>
        <div style={{
          width: 28,
          height: 28,
          borderRadius: '50%',
          background: 'var(--color-accent-muted)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          marginTop: 1,
        }}>
          <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--color-accent)' }}>Q</span>
        </div>
        <div style={{ flex: 1 }}>
          <p style={{ margin: 0, fontSize: '0.9rem', fontWeight: 500, color: 'var(--color-text-primary)' }}>
            {question}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
              <Clock size={10} /> {formatMs(response.elapsed_ms)}
            </span>
            {!isError && (
              <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
                · {formatNumber(response.row_count)} rows
              </span>
            )}
          </div>
        </div>
        {isError
          ? <span className="badge badge-error">Issue</span>
          : <span className="badge badge-accent">Ready</span>
        }
      </div>

      <div style={{ padding: '1.25rem' }}>
        {/* Error state */}
        {isError && (
          <div className="alert alert-error" style={{ marginBottom: '1rem' }}>
            <AlertTriangle size={15} style={{ flexShrink: 0 }} />
            <div>
              <strong>Analysis could not be completed</strong>
              <p style={{ margin: '0.25rem 0 0', fontSize: '0.8125rem', opacity: 0.85 }}>
                {response.error}
              </p>
            </div>
          </div>
        )}

        {/* Summary */}
        {response.summary && (
          <div style={{
            display: 'flex',
            gap: '0.75rem',
            marginBottom: '1.25rem',
            padding: '0.875rem 1rem',
            background: 'rgba(0,212,170,0.05)',
            border: '1px solid rgba(0,212,170,0.15)',
            borderRadius: 10,
          }}>
            <Sparkles size={15} color="var(--color-accent)" style={{ flexShrink: 0, marginTop: 2 }} />
            <p style={{ margin: 0, fontSize: '0.875rem', lineHeight: 1.65, color: 'var(--color-text-primary)' }}>
              {response.summary}
            </p>
          </div>
        )}

        {/* Truncation warning */}
        {response.truncated && response.limit_note && (
          <div className="alert alert-info" style={{ marginBottom: '1rem', fontSize: '0.8125rem' }}>
            <Info size={14} style={{ flexShrink: 0 }} />
            {response.limit_note}
          </div>
        )}

        {/* SQL collapsible */}
        {response.sql && (
          <div style={{ marginBottom: '1.25rem' }}>
            <button
              id={`sql-toggle-${item.id}`}
              onClick={() => setSqlOpen(o => !o)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--color-text-muted)',
                fontSize: '0.8rem',
                fontWeight: 500,
                padding: '0 0 0.5rem',
              }}
            >
              <Code2 size={13} />
              {sqlOpen ? 'Hide' : 'Inspect'} generated SQL
              {sqlOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </button>
            {sqlOpen && (
              <pre className="code-block animate-fade-in" style={{ margin: 0 }}>
                {response.sql}
              </pre>
            )}
          </div>
        )}

        {/* Table / Chart tabs */}
        {hasRows && (
          <div>
            {hasChart && (
              <div className="tab-list" style={{ marginBottom: '1rem', maxWidth: 240 }}>
                <button
                  id={`tab-table-${item.id}`}
                  className="tab-trigger"
                  data-active={activeTab === 'table'}
                  onClick={() => setActiveTab('table')}
                >
                  <TableIcon size={12} style={{ marginRight: 4 }} />
                  Rows
                </button>
                <button
                  id={`tab-chart-${item.id}`}
                  className="tab-trigger"
                  data-active={activeTab === 'chart'}
                  onClick={() => setActiveTab('chart')}
                >
                  <BarChart3 size={12} style={{ marginRight: 4 }} />
                  Visual
                </button>
              </div>
            )}

            {activeTab === 'table' && (
              <DataTable
                columns={response.columns}
                rows={response.rows}
                rowCount={response.row_count}
              />
            )}

            {activeTab === 'chart' && response.chart_suggestion && (
              <ResultChart
                suggestion={response.chart_suggestion}
                columns={response.columns}
                rows={response.rows}
              />
            )}
          </div>
        )}

        {/* Empty state */}
        {!isError && !hasRows && (
          <div style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>
            No matching records were found.
          </div>
        )}
      </div>
    </div>
  );
}
