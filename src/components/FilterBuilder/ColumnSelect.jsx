import { ChevronDown } from 'lucide-react';
import { memo, useEffect, useMemo, useRef, useState } from 'react';

function ColumnSelect({ columns, value, onChange, disabled }) {
  // `open` (the dropdown) and `focused`/`query` (the search input) are
  // otherwise independent — focusing the input alone doesn't open the
  // list, and the dropdown button opens/closes it on its own — but typing
  // a non-empty query does open it, so what you type is actually visible
  // as filtered results instead of disappearing into a closed dropdown.
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return columns;
    return columns.filter((c) => c.toLowerCase().includes(q));
  }, [columns, query]);

  const pick = (col) => {
    onChange(col);
    setQuery('');
    setOpen(false);
    setFocused(false);
    inputRef.current?.blur();
  };

  // Close the dropdown on an outside click, independent of the input's
  // own focus/blur (clicking a result already avoids blurring the input
  // via preventDefault on its mousedown).
  useEffect(() => {
    if (!open) return undefined;
    const handleDocMouseDown = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleDocMouseDown);
    return () => document.removeEventListener('mousedown', handleDocMouseDown);
  }, [open]);

  const toggleOpen = () => setOpen((o) => !o);

  return (
    <div className="fb-col-select-wrap" ref={wrapRef}>
      <div className="fb-col-select-input-wrap">
        <input
          ref={inputRef}
          type="text"
          className="fb-input fb-col-select-input"
          placeholder={disabled ? 'Loading columns...' : 'Search for columns'}
          autoComplete="off"
          disabled={disabled}
          value={focused ? query : value || ''}
          onFocus={() => setFocused(true)}
          onChange={(e) => {
            const next = e.target.value;
            setQuery(next);
            if (next.trim()) setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setOpen(false);
              setQuery('');
              inputRef.current?.blur();
            }
          }}
          onBlur={() => setFocused(false)}
        />
        {value && !open && (
          <button
            type="button"
            className="fb-col-select-clear"
            title="Clear column"
            onClick={() => onChange('')}
          >
            ✕
          </button>
        )}
      </div>
      <button
        type="button"
        className={`fb-col-select-toggle${open ? ' open' : ''}`}
        title={open ? 'Close column list' : 'Show all columns'}
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={toggleOpen}
      >
        <ChevronDown
          className={`fb-col-select-caret${open ? ' open' : ''}`}
          size={20}
          strokeWidth={2.5}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div className="fb-search-dropdown fb-col-select-dropdown">
          <div className="fb-search-results">
            {!filtered.length && (
              <div className="fb-search-no-results">
                No columns match "<strong>{query}</strong>"
              </div>
            )}
            {filtered.map((col) => (
              <div
                key={col}
                className={`fb-search-result-item${col === value ? ' selected' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(col)}
              >
                <span>{col}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(ColumnSelect);
