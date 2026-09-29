// src/components/SkeletonCard.jsx — loading placeholder while query processes
export default function SkeletonCard({ question }) {
  return (
    <div className="card" style={{ overflow: 'hidden', marginBottom: '1rem', opacity: 0.9 }}>
      {/* Question header */}
      <div style={{
        padding: '1rem 1.25rem',
        borderBottom: '1px solid var(--color-border-subtle)',
        display: 'flex',
        alignItems: 'center',
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
        }}>
          <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--color-accent)' }}>Q</span>
        </div>
        <p style={{ margin: 0, fontSize: '0.9rem', fontWeight: 500, color: 'var(--color-text-primary)', flex: 1 }}>
          {question}
        </p>
        <span className="badge badge-warning">Working…</span>
      </div>

      <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {/* Summary skeleton */}
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
          <div className="skeleton" style={{ width: 15, height: 15, borderRadius: '50%', flexShrink: 0, marginTop: 2 }} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div className="skeleton" style={{ height: 14, width: '85%' }} />
            <div className="skeleton" style={{ height: 14, width: '65%' }} />
          </div>
        </div>

        {/* SQL skeleton */}
        <div className="skeleton" style={{ height: 80, marginTop: '0.5rem' }} />

        {/* Table skeleton */}
        <div style={{ border: '1px solid var(--color-border)', borderRadius: 8, overflow: 'hidden', marginTop: '0.25rem' }}>
          {/* Header row */}
          <div style={{ display: 'flex', gap: '1rem', padding: '0.625rem 0.875rem', borderBottom: '1px solid var(--color-border)', background: '#111' }}>
            {[40, 80, 60, 70].map((w, i) => (
              <div key={i} className="skeleton" style={{ height: 10, width: w }} />
            ))}
          </div>
          {/* Data rows */}
          {[1, 2, 3, 4].map(i => (
            <div key={i} style={{ display: 'flex', gap: '1rem', padding: '0.5rem 0.875rem', borderBottom: '1px solid var(--color-border-subtle)' }}>
              {[55, 70, 50, 65].map((w, j) => (
                <div key={j} className="skeleton" style={{ height: 10, width: w * (0.8 + Math.random() * 0.4) }} />
              ))}
            </div>
          ))}
        </div>

        {/* Status message */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem' }}>
          <div
            style={{
              width: 8, height: 8, borderRadius: '50%',
              background: 'var(--color-accent)',
              animation: 'pulse-accent 1.5s ease-in-out infinite',
            }}
          />
          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
            Building the analysis and reading the data…
          </span>
        </div>
      </div>
    </div>
  );
}
