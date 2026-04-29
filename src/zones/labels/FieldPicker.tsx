import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
          border: '1px solid #ccc',
          background: open ? '#e6f0fb' : 'white',
          color: '#333',
          cursor: 'pointer',
        }}
      >
        Fields ({visibleFields.length})
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            className="tbrowse-fieldpicker"
            style={{
              position: 'fixed',
              left: pos.x,
              top: pos.y,
              background: 'white',
              border: '1px solid #ccc',
              borderRadius: 6,
              boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
              padding: '6px 0',
              zIndex: 1000,
              minWidth: 180,
            }}
          >
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
          </div>,
          document.body,
        )}
    </>
  );
}
