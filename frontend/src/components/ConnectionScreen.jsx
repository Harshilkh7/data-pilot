import { useState } from 'react';
import { Zap, ChevronRight, Eye, EyeOff, AlertCircle, Loader2 } from 'lucide-react';
import { connectWithString, connectManual, connectDemo } from '../api';
import BrandMark from './BrandMark';

export default function ConnectionScreen({ onConnected }) {
  const [mode, setMode] = useState('string');
  const [loading, setLoading] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [error, setError] = useState('');
  const [demoError, setDemoError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [connString, setConnString] = useState('');
  const [connStringError, setConnStringError] = useState('');

  const [dbType, setDbType] = useState('postgresql');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [database, setDatabase] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [manualErrors, setManualErrors] = useState({});

  const isConnectDisabled = mode === 'string'
    ? !connString.trim()
    : dbType === 'sqlite'
      ? !database.trim()
      : !host.trim() || !port.trim() || !database.trim() || !username.trim() || !password.trim();

  const handleDemo = async () => {
    setDemoLoading(true);
    setDemoError('');
    setError('');
    try {
      const res = await connectDemo();
      onConnected({
        session_id: res.session_id,
        database_name: res.database_name,
        db_type: res.db_type,
        schema_overview: res.schema_overview,
        connection_mode: 'demo',
      });
    } catch (e) {
      const msg = (e as { response?: { data?: { detail? } } })?.response?.data?.detail
        ?? (e instanceof Error ? e.message : 'Demo connection failed');
      setDemoError(msg);
    } finally {
      setDemoLoading(false);
    }
  };

  const handleConnect = async () => {
    if (mode === 'string') {
      if (!connString.trim()) {
        setConnStringError('Database URL is required.');
        return;
      }
      setConnStringError('');
    } else {
      const newErrors = {};
      if (dbType === 'sqlite') {
        if (!database.trim()) newErrors.database = 'SQLite file location is required.';
      } else {
        if (!host.trim()) newErrors.host = 'Server address is required.';
        if (!port.trim()) newErrors.port = 'Port is required.';
        if (!database.trim()) newErrors.database = 'Dataset name is required.';
        if (!username.trim()) newErrors.username = 'Account name is required.';
        if (!password.trim()) newErrors.password = 'Access key is required.';
      }
      if (Object.keys(newErrors).length > 0) {
        setManualErrors(newErrors);
        return;
      }
      setManualErrors({});
    }

    setLoading(true);
    setError('');
    try {
      let res;
      if (mode === 'string') {
        res = await connectWithString(connString.trim());
      } else {
        res = await connectManual({ db_type: dbType, host, port, database, username, password });
      }
      onConnected({
        session_id: res.session_id,
        database_name: res.database_name,
        db_type: res.db_type,
        schema_overview: res.schema_overview,
        connection_mode: 'custom',
      });
    } catch (e) {
      const msg = (e as { response?: { data?: { detail? } } })?.response?.data?.detail
        ?? (e instanceof Error ? e.message : 'Could not open the data source');
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div id="connection-screen" className="connection-shell">
      <div className="brand-hero">
        <div className="brand-mark">
          <BrandMark size={58} />
        </div>
        <h1 className="brand-title">DataPilot</h1>
        <p className="brand-subtitle">
          Ask questions in plain English. Get answers from your SQL data.
        </p>
      </div>

      <div className="connection-card">
        <button
          id="demo-connect-btn"
          className="demo-banner"
          onClick={handleDemo}
          disabled={demoLoading || loading}
        >
          {demoLoading ? <Loader2 size={15} className="animate-spin-slow" /> : <Zap size={15} />}
          {demoLoading ? 'Preparing sample workspace…' : 'Explore sample shop data'}
        </button>

        {demoError && (
          <div className="alert alert-error animate-fade-in" style={{ marginBottom: '1.5rem', fontSize: '0.8rem', padding: '0.625rem 0.875rem' }}>
            <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{demoError}</span>
          </div>
        )}

        <div className="or-divider">
          <hr className="divider" style={{ flex: 1 }} />
          <span style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>or use your database</span>
          <hr className="divider" style={{ flex: 1 }} />
        </div>

        <div className="tab-list connection-tabs">
          <button
            id="mode-string-btn"
            className="tab-trigger"
            data-active={mode === 'string'}
            onClick={() => setMode('string')}
          >
            Database URL
          </button>
          <button
            id="mode-manual-btn"
            className="tab-trigger"
            data-active={mode === 'manual'}
            onClick={() => setMode('manual')}
          >
            Direct setup
          </button>
        </div>

        {mode === 'string' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <label className="label" htmlFor="conn-string-input">Database URL</label>
              <input
                id="conn-string-input"
                className="input"
                type="text"
                placeholder="postgresql://user:pass@host:5432/database"
                value={connString}
                onChange={e => { setConnString(e.target.value); setConnStringError(''); }}
                onKeyDown={e => e.key === 'Enter' && handleConnect()}
                disabled={loading}
                style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', borderColor: connStringError ? 'var(--color-error)' : undefined }}
              />
              {connStringError && (
                <p style={{ color: 'var(--color-error)', fontSize: '0.75rem', marginTop: '0.25rem' }}>{connStringError}</p>
              )}
              <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.875rem', marginTop: '0.375rem' }}>
                PostgreSQL · MySQL · SQLite
              </p>
            </div>
          </div>
        )}

        {mode === 'manual' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
            <div>
              <label className="label" htmlFor="db-type-select">Engine</label>
              <select
                id="db-type-select"
                className="select"
                value={dbType}
                onChange={e => {
                  setDbType(e.target.value);
                  setManualErrors({});
                }}
              >
                <option value="postgresql">PostgreSQL</option>
                <option value="mysql">MySQL</option>
                <option value="sqlite">SQLite</option>
              </select>
            </div>

            {dbType !== 'sqlite' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.75rem' }}>
                <div>
                  <label className="label" htmlFor="host-input">Server</label>
                  <input
                    id="host-input"
                    className="input"
                    type="text"
                    placeholder="db.example.com"
                    value={host}
                    onChange={e => { setHost(e.target.value); setManualErrors(prev => ({ ...prev, host: undefined })); }}
                    disabled={loading}
                    style={{ borderColor: manualErrors.host ? 'var(--color-error)' : undefined }}
                  />
                  {manualErrors.host && <p style={{ color: 'var(--color-error)', fontSize: '0.7rem', marginTop: '0.2rem' }}>{manualErrors.host}</p>}
                </div>
                <div style={{ width: 90 }}>
                  <label className="label" htmlFor="port-input">Port</label>
                  <input
                    id="port-input"
                    className="input"
                    type="text"
                    placeholder={dbType === 'postgresql' ? '5432' : '3306'}
                    value={port}
                    onChange={e => { setPort(e.target.value); setManualErrors(prev => ({ ...prev, port: undefined })); }}
                    disabled={loading}
                    style={{ borderColor: manualErrors.port ? 'var(--color-error)' : undefined }}
                  />
                  {manualErrors.port && <p style={{ color: 'var(--color-error)', fontSize: '0.7rem', marginTop: '0.2rem' }}>{manualErrors.port}</p>}
                </div>
              </div>
            )}

            <div>
              <label className="label" htmlFor="database-input">{dbType === 'sqlite' ? 'SQLite file' : 'Dataset'}</label>
              <input
                id="database-input"
                className="input"
                type="text"
                placeholder={dbType === 'sqlite' ? './analytics.db' : 'commerce'}
                value={database}
                onChange={e => { setDatabase(e.target.value); setManualErrors(prev => ({ ...prev, database: undefined })); }}
                disabled={loading}
                style={{ borderColor: manualErrors.database ? 'var(--color-error)' : undefined }}
              />
              {manualErrors.database && <p style={{ color: 'var(--color-error)', fontSize: '0.7rem', marginTop: '0.2rem' }}>{manualErrors.database}</p>}
            </div>

            {dbType !== 'sqlite' && (
              <>
                <div>
                  <label className="label" htmlFor="username-input">Account</label>
                  <input
                    id="username-input"
                    className="input"
                    type="text"
                    placeholder="analytics_user"
                    value={username}
                    onChange={e => { setUsername(e.target.value); setManualErrors(prev => ({ ...prev, username: undefined })); }}
                    disabled={loading}
                    style={{ borderColor: manualErrors.username ? 'var(--color-error)' : undefined }}
                  />
                  {manualErrors.username && <p style={{ color: 'var(--color-error)', fontSize: '0.7rem', marginTop: '0.2rem' }}>{manualErrors.username}</p>}
                </div>
                <div>
                  <label className="label" htmlFor="password-input">Access key</label>
                  <div style={{ position: 'relative' }}>
                    <input
                      id="password-input"
                      className="input"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="••••••••"
                      value={password}
                      onChange={e => { setPassword(e.target.value); setManualErrors(prev => ({ ...prev, password: undefined })); }}
                      onKeyDown={e => e.key === 'Enter' && handleConnect()}
                      disabled={loading}
                      style={{ paddingRight: '2.5rem', borderColor: manualErrors.password ? 'var(--color-error)' : undefined }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(s => !s)}
                      style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: 0 }}
                    >
                      {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                  {manualErrors.password && <p style={{ color: 'var(--color-error)', fontSize: '0.7rem', marginTop: '0.2rem' }}>{manualErrors.password}</p>}
                </div>
              </>
            )}
          </div>
        )}

        {error && (
          <div className="alert alert-error animate-fade-in" style={{ marginTop: '1rem' }}>
            <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{error}</span>
          </div>
        )}

        <button
          id="connect-btn"
          className="connect-main"
          onClick={handleConnect}
          disabled={loading || demoLoading || isConnectDisabled}
        >
          {loading ? (
            <>
              <Loader2 size={15} className="animate-spin-slow" />
              Opening workspace…
            </>
          ) : (
            <>
              Open workspace <ChevronRight size={15} />
            </>
          )}
        </button>
      </div>

      <div className="connection-footer">
        <div
          className="badge badge-accent animate-fade-in"
          style={{
            fontSize: '0.75rem',
            padding: '0.35rem 0.75rem',
            borderRadius: '999px',
            background: 'rgba(139,92,246,.06)',
            border: '1px solid rgba(139,92,246,.15)',
            color: 'var(--color-accent)',
            fontWeight: 500,
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.375rem',
            letterSpacing: 'normal',
            textTransform: 'none',
          }}
        >
          <Zap size={11} fill="var(--color-accent)" /> Gemini-assisted analysis
        </div>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.7rem', margin: 0 }}>
          Connection secrets stay in memory only · Queries are read-only
        </p>
      </div>
    </div>
  );
}
