import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTBrowseStore } from '../../store';
import type { LabelField } from './fields';
import { GearIcon } from '../../icons/GearIcon';

interface LabelsConfigPopoverProps {
  fields: LabelField[];
  visibleFields: string[];
  onChange: (next: string[]) => void;
}

/**
 * Standardised gear-icon popover for picking which Labels-zone fields
 * are visible. Anchored to the host zone's bounds (matching the
 * table + MSA zones) — its right edge lines up with the zone's right
 * edge and its width is capped at the zone's width.
 */
export function LabelsConfigPopover({
  fields,
  visibleFields,
  onChange,
}: LabelsConfigPopoverProps) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{
    right: number;
    top: number;
    maxWidth: number;
  } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const theme = useTBrowseStore((s) => s.theme);

  const visibleSet = new Set(visibleFields);

  const togglePopover = () => {
    if (!open && buttonRef.current) {
      const btnRect = buttonRef.current.getBoundingClientRect();
      const zoneEl = buttonRef.current.closest<HTMLElement>(
        '[data-labels-zone-header]',
      );
      const zoneRect = zoneEl?.getBoundingClientRect();
      const right = zoneRect
        ? Math.max(0, window.innerWidth - zoneRect.right)
        : Math.max(0, window.innerWidth - btnRect.right);
      const zoneWidth = zoneRect ? zoneRect.right - zoneRect.left : 240;
      const maxWidth = Math.max(220, zoneWidth);
      setAnchor({ right, top: btnRect.bottom + 4, maxWidth });
    }
    setOpen((o) => !o);
  };

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target)) return;
      const popover = document.querySelector('.tbrowse-labels-config');
      if (popover?.contains(target)) return;
      setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  const toggleField = (id: string) => {
    if (visibleSet.has(id)) {
      onChange(visibleFields.filter((f) => f !== id));
    } else {
      // Preserve the canonical ordering of `fields` rather than the
      // click order, so visible fields always render in stable order.
      const set = new Set([...visibleFields, id]);
      onChange(fields.filter((f) => set.has(f.id)).map((f) => f.id));
    }
  };

  const builtins = fields.filter((f) => f.kind === 'builtin');
  const externals = fields.filter((f) => f.kind === 'provider');

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={togglePopover}
        title="Configure visible label fields"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          padding: '3px 6px',
          borderRadius: 3,
          border: '1px solid var(--tbrowse-border)',
          background: open
            ? 'var(--tbrowse-accent-soft)'
            : 'var(--tbrowse-bg-input)',
          color: 'var(--tbrowse-text)',
          cursor: 'pointer',
        }}
      >
        <GearIcon />
      </button>
      {open &&
        anchor &&
        createPortal(
          <div className={`tbrowse-root tbrowse-theme-${theme}`}>
            <div
              className="tbrowse-labels-config"
              style={{
                position: 'fixed',
                right: anchor.right,
                top: anchor.top,
                boxSizing: 'border-box',
                background: 'var(--tbrowse-bg-elevated)',
                border: '1px solid var(--tbrowse-border)',
                color: 'var(--tbrowse-text)',
                borderRadius: 6,
                boxShadow: '0 4px 16px var(--tbrowse-tooltip-shadow)',
                padding: '8px 0',
                zIndex: 2000,
                fontSize: 12,
              }}
            >
              {renderGroup('Built-in', builtins, visibleSet, toggleField)}
              {externals.length > 0 && (
                <>
                  <div
                    style={{
                      height: 1,
                      background: 'var(--tbrowse-border-soft)',
                      margin: '4px 0',
                    }}
                  />
                  {renderGroup('External', externals, visibleSet, toggleField)}
                </>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

function renderGroup(
  title: string,
  fields: LabelField[],
  visibleSet: Set<string>,
  toggleField: (id: string) => void,
) {
  if (fields.length === 0) return null;
  return (
    <>
      <div
        style={{
          padding: '2px 12px',
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          color: 'var(--tbrowse-text-subtle)',
          fontWeight: 600,
        }}
      >
        {title}
      </div>
      {fields.map((f) => {
        const checked = visibleSet.has(f.id);
        return (
          <label
            key={f.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '4px 12px',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={() => toggleField(f.id)}
              style={{ margin: 0 }}
            />
            <span>{f.label}</span>
          </label>
        );
      })}
    </>
  );
}
