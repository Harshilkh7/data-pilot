// src/components/QueryInput.tsx — chat-style question input
import { useRef, useState } from 'react';
import { Send, Loader2 } from 'lucide-react';

interface Props {
  onSubmit: (question: string) => void;
  loading: boolean;
  disabled?: boolean;
}

const EXAMPLE_QUESTIONS = [
  'Which artist has the most albums?',
  'Show me the top 10 customers by total spend.',
  'How many tracks are in the Rock genre?',
  'What is the total revenue by country?',
];

export default function QueryInput({ onSubmit, loading, disabled }: Props) {
  const [question, setQuestion] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = () => {
    const q = question.trim();
    if (!q || loading) return;
    onSubmit(q);
    setQuestion('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setQuestion(e.target.value);
    // Auto-resize
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  };

  return (
    <div>
      {/* Example chips */}
      {!loading && !question && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '0.625rem',
          marginBottom: '0.875rem',
        }}>
          {EXAMPLE_QUESTIONS.map(q => (
            <button
              key={q}
              className="btn btn-ghost"
              onClick={() => { setQuestion(q); textareaRef.current?.focus(); }}
              style={{
                fontSize: '0.75rem',
                padding: '0.5rem 0.75rem',
                border: '1px solid var(--color-border)',
                whiteSpace: 'normal',
                textAlign: 'left',
                justifyContent: 'flex-start',
                height: 'auto',
                lineHeight: 1.35,
              }}
            >
              {q}
            </button>
          ))}
        </div>
      )}

      {/* Input row */}
      <div style={{
        display: 'flex',
        gap: '0.75rem',
        alignItems: 'flex-end',
        background: 'var(--color-bg-card)',
        border: '1px solid var(--color-border)',
        borderRadius: 12,
        padding: '0.625rem 0.75rem',
        transition: 'border-color 0.15s, box-shadow 0.15s',
        boxShadow: question ? '0 0 0 3px var(--color-accent-muted)' : 'none',
        borderColor: question ? 'var(--color-accent)' : 'var(--color-border)',
      }}>
        <textarea
          id="question-input"
          ref={textareaRef}
          className="input"
          placeholder="Ask anything about your data…"
          value={question}
          onChange={handleInput}
          onKeyDown={handleKey}
          disabled={loading || disabled}
          rows={1}
          style={{
            flex: 1,
            resize: 'none',
            background: 'transparent',
            border: 'none',
            boxShadow: 'none',
            padding: '0.25rem 0',
            fontSize: '0.9rem',
            lineHeight: 1.5,
            minHeight: 36,
          }}
        />
        <button
          id="submit-question-btn"
          className="btn btn-primary"
          onClick={handleSubmit}
          disabled={!question.trim() || loading || disabled}
          style={{ height: 36, width: 36, padding: 0, borderRadius: 8, flexShrink: 0 }}
        >
          {loading
            ? <Loader2 size={16} className="animate-spin-slow" />
            : <Send size={15} />
          }
        </button>
      </div>
      <p style={{ color: 'var(--color-text-muted)', fontSize: '0.7rem', marginTop: '0.375rem', textAlign: 'right' }}>
        Enter to send · Shift+Enter for new line
      </p>
    </div>
  );
}
