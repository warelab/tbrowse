import { Outlet } from 'react-router-dom';
import { Navbar } from './Navbar';

/** App shell: a fixed navbar above the routed page. The chrome (navbar
 *  + marketing pages) uses the light theme; the playground re-declares
 *  its own `tbrowse-theme-*` class on its root, so its in-app theme
 *  toggle still flips independently. `<main>` is `overflow: hidden` —
 *  each page owns its internal scroll (the playground its zone bodies,
 *  the content pages their reading column). */
export function Layout() {
  return (
    <div
      className="tbrowse-root tbrowse-theme-light"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        background: 'var(--tbrowse-bg)',
        color: 'var(--tbrowse-text)',
      }}
    >
      <Navbar />
      <main style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <Outlet />
      </main>
    </div>
  );
}
