/**
 * TBrowse theme support.
 *
 * The component palette is exposed as CSS custom properties scoped under
 * `.tbrowse-theme-light` / `.tbrowse-theme-dark`. Component code refers
 * to those properties via inline styles (`var(--tbrowse-bg)` etc.), and
 * the host opts in by setting `<TBrowse theme="dark">`. We inject the
 * stylesheet on first render so consumers don't have to import a CSS
 * file separately — the lib still works as a single JS import.
 *
 * Things that are intentionally NOT themed:
 *   - Residue colours (Clustal, hydrophobicity, nucleotide) — biology.
 *   - Domain hash colours — stable identity across sessions.
 *   - Selection-marker amber — readable on both backgrounds.
 *   - Splice-junction red, pruned-stub greys — same.
 *
 * Canvas-drawn pixels in the MSA body keep hard-coded literals for now
 * (canvas can't read CSS custom properties without an extra
 * getComputedStyle pass). The chrome around them — backgrounds,
 * borders, control text — IS themed.
 */

const THEME_CSS = `
.tbrowse-root {
  /* Defaults match the light theme so that even un-themed (stylesheet
     not yet injected, or no class applied for some reason) the look is
     reasonable. */
  --tbrowse-bg: #ffffff;
  --tbrowse-bg-alt: #f7f7f7;
  --tbrowse-bg-strip: #fafafa;
  --tbrowse-bg-elevated: #ffffff;
  --tbrowse-bg-input: #ffffff;
  --tbrowse-text: #222222;
  --tbrowse-text-muted: #666666;
  --tbrowse-text-subtle: #999999;
  --tbrowse-border: #cccccc;
  --tbrowse-border-soft: #eeeeee;
  --tbrowse-border-row: #f0f0f0;
  --tbrowse-divider: #dddddd;
  --tbrowse-accent: #2878dc;
  --tbrowse-accent-strong: #1d5fb1;
  --tbrowse-accent-soft: #e6f0fb;
  --tbrowse-accent-fg: #ffffff;
  --tbrowse-danger: #c0392b;
  --tbrowse-tooltip-shadow: rgba(0, 0, 0, 0.12);
  --tbrowse-row-hover-bg: rgba(40, 120, 220, 0.08);
  --tbrowse-row-select-bg: rgba(40, 120, 220, 0.15);
  --tbrowse-row-subtree-bg: rgba(40, 120, 220, 0.04);
  --tbrowse-branch: #444444;
  --tbrowse-leaf-extension: #bbbbbb;
}
.tbrowse-theme-dark {
  --tbrowse-bg: #1c1f24;
  --tbrowse-bg-alt: #24272d;
  --tbrowse-bg-strip: #20232a;
  --tbrowse-bg-elevated: #2e3138;
  --tbrowse-bg-input: #2a2d34;
  --tbrowse-text: #e7e9ed;
  --tbrowse-text-muted: #a8aeb6;
  --tbrowse-text-subtle: #7a8089;
  --tbrowse-border: #444851;
  --tbrowse-border-soft: #2f3239;
  --tbrowse-border-row: #2a2d34;
  --tbrowse-divider: #3a3e46;
  --tbrowse-accent: #5fa0f0;
  --tbrowse-accent-strong: #80b3f4;
  --tbrowse-accent-soft: #1f3a5f;
  --tbrowse-accent-fg: #0e1116;
  --tbrowse-danger: #e57373;
  --tbrowse-tooltip-shadow: rgba(0, 0, 0, 0.6);
  --tbrowse-row-hover-bg: rgba(120, 170, 240, 0.16);
  --tbrowse-row-select-bg: rgba(120, 170, 240, 0.26);
  --tbrowse-row-subtree-bg: rgba(120, 170, 240, 0.07);
  --tbrowse-branch: #cdd1d8;
  --tbrowse-leaf-extension: #5d6068;
}
`;

let injected = false;

/**
 * Insert the theme stylesheet into the document head if it isn't already
 * there. Idempotent and SSR-safe; no-op when there's no document. Called
 * once during the first render of TBrowse.
 */
export function ensureThemeStylesInjected(): void {
  if (injected) return;
  if (typeof document === 'undefined') return;
  const id = 'tbrowse-theme-style';
  if (document.getElementById(id)) {
    injected = true;
    return;
  }
  const style = document.createElement('style');
  style.id = id;
  style.textContent = THEME_CSS;
  document.head.appendChild(style);
  injected = true;
}
