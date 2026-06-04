import React from 'react';

/** Scrollable, centered reading column shared by the About and
 *  Developers pages. The routed `<main>` is `overflow: hidden`, so each
 *  content page owns its own vertical scroll here. */
export function Prose({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        height: '100%',
        overflowY: 'auto',
        background: 'var(--tbrowse-bg)',
        color: 'var(--tbrowse-text)',
      }}
    >
      <div
        style={{
          maxWidth: 760,
          margin: '0 auto',
          padding: '40px 24px 64px',
          lineHeight: 1.6,
          fontSize: 15,
        }}
      >
        {children}
      </div>
    </div>
  );
}

export const h2Style: React.CSSProperties = {
  margin: '36px 0 10px',
  fontSize: 13,
  textTransform: 'uppercase',
  letterSpacing: 0.6,
  color: 'var(--tbrowse-text-muted)',
};

export const listStyle: React.CSSProperties = {
  margin: '0 0 8px',
  paddingLeft: 22,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

/** Inline `code`. */
export function Code({ children }: { children: React.ReactNode }) {
  return (
    <code
      style={{
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '0.88em',
        padding: '1px 5px',
        borderRadius: 4,
        background: 'var(--tbrowse-bg-alt)',
        border: '1px solid var(--tbrowse-border-soft)',
      }}
    >
      {children}
    </code>
  );
}

/** Fenced code block. */
export function CodeBlock({ children }: { children: string }) {
  return (
    <pre
      style={{
        margin: '12px 0',
        padding: '14px 16px',
        borderRadius: 8,
        overflowX: 'auto',
        background: 'var(--tbrowse-bg-alt)',
        border: '1px solid var(--tbrowse-border-soft)',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 13,
        lineHeight: 1.5,
        color: 'var(--tbrowse-text)',
      }}
    >
      <code>{children}</code>
    </pre>
  );
}
