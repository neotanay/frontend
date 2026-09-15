import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useFilters } from '../../context/FilterContext';

const VISIBLE_LIMIT = 2;

const VALUE_TRUNCATE_LENGTH = 25;

function ChipValue({ value }) {
  const [expanded, setExpanded] = useState(false);
  if (value.length <= VALUE_TRUNCATE_LENGTH) return value;
  return (
    <>
      {expanded ? value : `${value.slice(0, VALUE_TRUNCATE_LENGTH)}…`}
      <button
        type="button"
        className="fb-chip-more-toggle"
        onClick={(e) => {
          e.stopPropagation();
          setExpanded((v) => !v);
        }}
      >
        {expanded ? 'less' : 'more'}
      </button>
    </>
  );
}

function ValuesPopover({ col, values, anchorRect, onRemoveValue, onClearColumn, onClose }) {
  const popRef = useRef(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    const handlePointerDown = (e) => {
      if (popRef.current && !popRef.current.contains(e.target)) onClose();
    };
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return values;
    return values.filter((v) => String(v).toLowerCase().includes(q));
  }, [values, query]);

  const width = 240;
  const viewportMargin = 8;
  const left = Math.min(anchorRect.left, window.innerWidth - width - viewportMargin);
  const spaceBelow = window.innerHeight - anchorRect.bottom;
  const openUpward = spaceBelow < 260 && anchorRect.top > 260;
  const style = openUpward
    ? { left, bottom: window.innerHeight - anchorRect.top + 6, width }
    : { left, top: anchorRect.bottom + 6, width };

  return (
    <div className="fb-values-popover" ref={popRef} style={style}>
      <div className="fb-values-popover-head">
        <span>
          {col} <span className="fb-values-popover-count">({values.length})</span>
        </span>
        <button
          className="fb-values-popover-close"
          onClick={onClose}
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      {values.length > 8 && (
        <input
          type="text"
          className="fb-input fb-values-popover-search"
          placeholder="Search values..."
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}

      <div className="fb-values-popover-list">
        {!filtered.length && <div className="fb-search-no-results">No values match</div>}
        {filtered.map((v) => {
          const vStr = String(v);
          return (
            <span className="fb-chip" key={vStr}>
              <ChipValue value={vStr} />
              <button
                className="fb-chip-x"
                onClick={() => onRemoveValue(col, vStr)}
                aria-label={`Remove ${vStr}`}
              >
                ✕
              </button>
            </span>
          );
        })}
      </div>

      <button
        className="fb-values-popover-clear"
        onClick={() => {
          onClearColumn(col);
          onClose();
        }}
      >
        Clear all {values.length}
      </button>
    </div>
  );
}

function AppliedFilters({ onRemoveValue, onClearColumn, onClearAll }) {
  const { appliedFilters } = useFilters();
  const entries = Object.entries(appliedFilters);
  const [openCol, setOpenCol] = useState(null);
  const [anchorRect, setAnchorRect] = useState(null);

  const openPopover = (col, e) => {
    setAnchorRect(e.currentTarget.getBoundingClientRect());
    setOpenCol(col);
  };
  const closePopover = () => setOpenCol(null);

  useEffect(() => {
    if (!openCol) return;
    const entry = appliedFilters[openCol];
    if (!entry || entry.values.length <= VISIBLE_LIMIT) setOpenCol(null);
  }, [openCol, appliedFilters]);

  return (
    <>
      <div className="fb-applied-header">
        <span className="fb-applied-title">Applied Filters</span>
        {entries.length > 0 && (
          <button type="button" className="fb-applied-clear-all" onClick={onClearAll}>
            Clear all <span className="fb-applied-clear-all-count">{entries.length}</span>
          </button>
        )}
      </div>
      <div className="fb-applied-section">


        {!entries.length ? (
          <div className="fb-empty-msg">No filters applied yet.</div>
        ) : (
          <div className="fb-applied-list">
            {entries.map(([col, { values }]) => {
            const hiddenCount = values.length - VISIBLE_LIMIT;
            const visibleValues = hiddenCount > 0 ? values.slice(0, VISIBLE_LIMIT) : values;

            return (
              <div key={col} className="fb-applied-row">
                <div className="fb-applied-label-strip">
                  <span className="fb-applied-col">{col}</span>
                  <button
                    className="fb-clear-row"
                    onClick={() => onClearColumn(col)}
                    aria-label={`Clear ${col} filter`}
                    title={`Clear ${col} filter`}
                  >
                    ✕
                  </button>
                </div>
                <div className="fb-applied-values">
                  {visibleValues.map((v) => {
                    const vStr = String(v);
                    return (
                      <div className="fb-value-pill" key={vStr}>
                        <span>
                          <ChipValue value={vStr} />
                        </span>
                        <button
                          className="fb-chip-x"
                          onClick={() => onRemoveValue(col, vStr)}
                          aria-label={`Remove ${vStr}`}
                        >
                          ✕
                        </button>
                      </div>
                    );
                  })}
                  {hiddenCount > 0 && (
                    <button className="fb-chip-more" onClick={(e) => openPopover(col, e)}>
                      +{hiddenCount} more
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        )}
      </div>

      {openCol && (
        <ValuesPopover
          col={openCol}
          values={appliedFilters[openCol]?.values || []}
          anchorRect={anchorRect}
          onRemoveValue={onRemoveValue}
          onClearColumn={onClearColumn}
          onClose={closePopover}
        />
      )}
    </>
  );
}

export default memo(AppliedFilters);
