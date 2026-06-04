import { NavLink } from 'react-router-dom';
import { TBrowseLogo } from 'tbrowse';

const REPO_URL = 'https://github.com/warelab/tbrowse';

/** Shared top navigation. Sits above the routed page content and links
 *  the landing page, the playground, the developer guide, and the
 *  GitHub repo. Themed via the same `--tbrowse-*` tokens as everything
 *  else (the entry injects the stylesheet at startup). */
export function Navbar() {
  return (
    <header
      style={{
        flex: '0 0 auto',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        padding: '0 16px',
        height: 48,
        borderBottom: '1px solid var(--tbrowse-divider)',
        background: 'var(--tbrowse-bg-strip)',
        color: 'var(--tbrowse-text)',
      }}
    >
      <NavLink
        to="/"
        aria-label="TBrowse home"
        style={{ display: 'inline-flex', alignItems: 'center' }}
      >
        <TBrowseLogo height={24} variant="light" />
      </NavLink>

      <nav style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <NavItem to="/" end>
          About
        </NavItem>
        <NavItem to="/playground">Playground</NavItem>
        <NavItem to="/developers">Developers</NavItem>
        <a
          href={REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          title="View source on GitHub"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            marginLeft: 8,
            padding: '6px 10px',
            fontSize: 13,
            borderRadius: 5,
            color: 'var(--tbrowse-text-muted)',
            textDecoration: 'none',
          }}
        >
          <GitHubMark />
          GitHub
        </a>
      </nav>
    </header>
  );
}

function NavItem({
  to,
  end,
  children,
}: {
  to: string;
  end?: boolean;
  children: React.ReactNode;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      style={({ isActive }) => ({
        padding: '6px 10px',
        fontSize: 13,
        borderRadius: 5,
        textDecoration: 'none',
        color: isActive ? 'var(--tbrowse-accent)' : 'var(--tbrowse-text-muted)',
        fontWeight: isActive ? 600 : 400,
        background: isActive ? 'var(--tbrowse-accent-soft)' : 'transparent',
      })}
    >
      {children}
    </NavLink>
  );
}

function GitHubMark() {
  return (
    <svg
      width={15}
      height={15}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"
      />
    </svg>
  );
}
