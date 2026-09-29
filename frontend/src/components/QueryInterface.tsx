import { useRef, useState, useEffect } from 'react';
import { LogOut } from 'lucide-react';
import type { AppSession, QueryHistoryItem } from '../types';
import { connectDemo, runQuery } from '../api';
import { generateId } from '../lib/utils';
import SchemaPanel from './SchemaPanel';
import QueryInput from './QueryInput';
import ResponseCard from './ResponseCard';
import SkeletonCard from './SkeletonCard';
import BrandMark from './BrandMark';

interface Props {
  session: AppSession;
  onDisconnect: () => void;
  onSessionRefresh: (session: AppSession) => void;
}

export default function QueryInterface({ session, onDisconnect, onSessionRefresh }: Props) {
  const [history, setHistory] = useState<QueryHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [pendingQuestion, setPendingQuestion] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history, loading]);

  const handleQuestion = async (question: string) => {
    setLoading(true);
    setPendingQuestion(question);
    try {
      let activeSession = session;
      let response;
      try {
        response = await runQuery(activeSession.session_id, question);
      } catch (e: unknown) {
        const status = (e as { response?: { status?: number } })?.response?.status;
        if (status !== 404 || activeSession.connection_mode !== 'demo') throw e;

        const res = await connectDemo();
        const refreshedSession: AppSession = {
          session_id: res.session_id,
          database_name: res.database_name,
          db_type: res.db_type,
          schema_overview: res.schema_overview,
          connection_mode: 'demo',
        };
        activeSession = refreshedSession;
        onSessionRefresh(refreshedSession);
        response = await runQuery(refreshedSession.session_id, question);
      }

      setHistory(h => [...h, {
        id: generateId(),
        question,
        response,
        timestamp: new Date(),
      }]);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        ?? (e instanceof Error ? e.message : 'Analysis failed');
      setHistory(h => [...h, {
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
      }]);
    } finally {
      setLoading(false);
      setPendingQuestion('');
    }
  };

  return (
    <div className="workspace-shell">
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
          <BrandMark size={30} />
          <span style={{ fontWeight: 700, fontSize: '1rem', letterSpacing: '-0.01em' }}>DataPilot</span>
        </div>

        <div className="workspace-topbar-spacer" />

        <div className="workspace-meta">
          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
            Active source
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
            <LogOut size={13} /> Close workspace
          </button>
        </div>
      </header>

      <div className="workspace-scroll">
        <div className="workspace-content">
          <div className="schema-wrap">
            <SchemaPanel
              databaseName={session.database_name}
              dbType={session.db_type}
              tables={session.schema_overview}
              sessionId={session.session_id}
            />
          </div>

          {history.length === 0 && !loading && (
            <div className="workspace-empty">
              <div className="empty-orbit"><span>⌁</span></div>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--color-text-secondary)', margin: '0 0 0.5rem' }}>
                Start with a data question
              </h2>
              <p style={{ fontSize: '0.875rem', margin: 0 }}>
                Ask in plain English and DataPilot will turn your request into a safe, executable query.
              </p>
            </div>
          )}

          {history.map(item => (
            <ResponseCard key={item.id} item={item} />
          ))}

          {loading && pendingQuestion && (
            <SkeletonCard question={pendingQuestion} />
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      <div className="query-dock">
        <div className="query-dock-inner">
          <QueryInput onSubmit={handleQuestion} loading={loading} />
        </div>
      </div>
    </div>
  );
}
