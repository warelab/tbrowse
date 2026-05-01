import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTBrowseStore } from '../../store';
import type { LabelField } from './fields';

interface FieldPickerProps {
  fields: LabelField[];
  visibleFields: string[];
  onChange: (next: string[]) => void;
}

export function FieldPicker({ fields, visibleFields, onChange }: FieldPickerProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // Read theme from the store so the portaled popover can re-attach
  // the `tbrowse-theme-*` class and resolve our CSS variables.
  const theme = useTBrowseStore((s) => s.theme);

  const visibleSet = new Set(visibleFields);

  const togglePicker = () => {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPos({ x: rect.left, y: rect.bottom + 4 });
    }
    setOpen((o) => !o);
  };

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target)) return;
      const popover = document.querySelector('.tbrowse-fieldpicker');
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
      // Preserve the ordering of `fields` rather than the click order, so
      // visible fields render in a stable canonical order.
      const set = new Set([...visibleFields, id]);
      onChange(fields.filter((f) => set.has(f.id)).map((f) => f.id));
    }
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={togglePicker}
        style={{
          fontSize: 11,
          padding: '2px 8px',
          borderRadius: 3,
          border: '1px solid var(--tbrowse-border)',
          background: open ? 'var(--tbrowse-accent-soft)' : 'var(--tbrowse-bg-input)',
          color: 'var(--tbrowse-text)',
          cursor: 'pointer',
        }}
      >
        Fields ({visibleFields.length})
      </button>
      {open &&
        pos &&
        createPortal(
          <div className={`tbrowse-root tbrowse-theme-${theme}`}>
          <div
            className="tbrowse-fieldpicker"
            style={{
              position: 'fixed',
              left: pos.x,
              top: pos.y,
              background: 'var(--tbrowse-bg-elevated)',
              border: '1px solid var(--tbrowse-border)',
              color: 'var(--tbrowse-text)',
              borderRadius: 6,
              boxShadow: '0 4px 16px var(--tbrowse-tooltip-shadow)',
              padding: '6px 0',
              zIndex: 1000,
              minWidth: 200,
            }}
          >
            {renderGroup('Built-in', fields.filter((f) => f.kind === 'builtin'), visibleSet, toggleField)}
            {fields.some((f) => f.kind === 'provider') && (
              <>
                <div
                  style={{
                    height: 1,
                    background: 'var(--tbrowse-border-soft)',
                    margin: '4px 0',
                  }}
                />
                {renderGroup('External', fields.filter((f) => f.kind === 'provider'), visibleSet, toggleField)}
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
