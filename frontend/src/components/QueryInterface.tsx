// src/components/QueryInterface.tsx — main post-connection dashboard
import { useRef, useState, useEffect } from 'react';
import { LogOut, Database } from 'lucide-react';
import type { AppSession, QueryHistoryItem } from '../types';
import { runQuery } from '../api';
import { generateId } from '../lib/utils';
import SchemaPanel from './SchemaPanel';
import QueryInput from './QueryInput';
import ResponseCard from './ResponseCard';
import SkeletonCard from './SkeletonCard';

interface Props {
  session: AppSession;
  onDisconnect: () => void;
}

export default function QueryInterface({ session, onDisconnect }: Props) {
  const [history, setHistory] = useState<QueryHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [pendingQuestion, setPendingQuestion] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new cards are added
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history, loading]);

  const handleQuestion = async (question: string) => {
    setLoading(true);
    setPendingQuestion(question);
    try {
      const response = await runQuery(session.session_id, question);
      const item: QueryHistoryItem = {
        id: generateId(),
        question,
        response,
        timestamp: new Date(),
      };
      setHistory(h => [...h, item]);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        ?? (e instanceof Error ? e.message : 'Query failed');
      const item: QueryHistoryItem = {
        id: generateId(),
        question,
        response: {
          sql: '',
          summary: '',
          columns: [],
          rows: [],
          row_count: 0,
          truncated: false,
          limit_note: '',
          chart_suggestion: null,
          error: msg,
          elapsed_ms: 0,
        },
        timestamp: new Date(),
      };
      setHistory(h => [...h, item]);
    } finally {
      setLoading(false);
      setPendingQuestion('');
    }
  };

  return (
    <div className="workspace-shell">
      {/* Top navigation bar */}
      <header className="workspace-topbar" style={{
        display: 'flex',
        alignItems: 'center',
        gap: '1rem',
        padding: '0.75rem 1.5rem',
        borderBottom: '1px solid var(--color-border)',
        background: 'var(--color-bg-card)',
        flexShrink: 0,
        zIndex: 10,
      }}>
        <div className="workspace-brand">
          <Database size={18} color="var(--color-accent)" />
          <span style={{ fontWeight: 700, fontSize: '1rem', letterSpacing: '-0.01em' }}>DataPilot</span>
        </div>

        <div className="workspace-topbar-spacer" />

        <div className="workspace-meta">
          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
            Connected to
          </span>
          <span className="badge badge-accent">
            {session.database_name}
          </span>
          <button
            id="disconnect-btn"
            className="btn btn-ghost"
            onClick={onDisconnect}
            style={{ fontSize: '0.75rem', gap: '0.375rem' }}
          >
            <LogOut size={13} /> Disconnect
          </button>
        </div>
      </header>

      {/* Main content area — scrollable */}
      <div className="workspace-scroll">
        <div className="workspace-content">

          {/* Schema panel */}
          <div className="schema-wrap">
            <SchemaPanel
              databaseName={session.database_name}
              dbType={session.db_type}
              tables={session.schema_overview}
              sessionId={session.session_id}
            />
          </div>

          {/* Empty state */}
          {history.length === 0 && !loading && (
            <div className="workspace-empty">
              <div className="empty-orbit"><span>✦</span></div>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--color-text-secondary)', margin: '0 0 0.5rem' }}>
                Ask your first question
              </h2>
              <p style={{ fontSize: '0.875rem', margin: 0 }}>
                Type a question below to query <strong style={{ color: 'var(--color-accent)' }}>{session.database_name}</strong> in plain English.
              </p>
            </div>
          )}

          {/* Query history */}
          {history.map(item => (
            <ResponseCard key={item.id} item={item} />
          ))}

          {/* Loading skeleton */}
          {loading && pendingQuestion && (
            <SkeletonCard question={pendingQuestion} />
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Sticky input bar */}
      <div className="query-dock">
        <div className="query-dock-inner">
          <QueryInput
            onSubmit={handleQuestion}
            loading={loading}
          />
        </div>
      </div>
    </div>
  );
}
