import { useEffect, useRef, useState } from 'react';

export interface EditableZoneNameProps {
  /** The factory-provided default; shown when no override is set. */
  defaultName: string;
  /** The user's override, or undefined when at default. */
  customName: string | undefined;
  /** Called when the user commits a new name. Receives `undefined` when
   *  the input is blanked, signalling "back to the factory default". */
  onChange: (next: string | undefined) => void;
  /** Maximum text width before the label truncates with an ellipsis. */
  maxWidth?: number;
}

/**
 * Click-to-rename label used in every zone header. Click → input,
 * Enter or blur commits, Escape cancels. Blanking the input restores
 * the factory default.
 */
export function EditableZoneName({
  defaultName,
  customName,
  onChange,
  maxWidth = 160,
}: EditableZoneNameProps) {
  const name = customName ?? defaultName;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!editing) setDraft(name);
  }, [editing, name]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const commit = () => {
    const trimmed = draft.trim();
    onChange(trimmed === '' || trimmed === defaultName ? undefined : trimmed);
    setEditing(false);
  };
  const cancel = () => {
    setDraft(name);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          else if (e.key === 'Escape') cancel();
        }}
        style={{
          fontWeight: 600,
          fontSize: 13,
          background: 'var(--tbrowse-bg-input)',
          color: 'var(--tbrowse-text)',
          border: '1px solid var(--tbrowse-border)',
          borderRadius: 3,
          padding: '1px 4px',
          minWidth: 60,
          maxWidth,
        }}
      />
    );
  }
  return (
    <span
      onClick={() => setEditing(true)}
      title="Click to rename"
      style={{
        fontWeight: 600,
        cursor: 'text',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        maxWidth,
      }}
    >
      {name}
    </span>
  );
}
