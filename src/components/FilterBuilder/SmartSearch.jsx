import { Search } from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';
import { searchAllColumns } from '../../api/filters';
import { useFilters } from '../../context/FilterContext';

function HighlightedText({ text, query }) {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark>{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

function SmartSearch({ onApplySelections }) {
  const { appliedFilters, canonicalColumn } = useFilters();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selections, setSelections] = useState({});
  const initialSelectionsRef = useRef({});
  const inputRef = useRef(null);
  const wrapRef = useRef(null);
  const searchRowRef = useRef(null);
  const [anchorRect, setAnchorRect] = useState(null);

  const runSearch = async () => {
    const q = query.trim();
    if (!q) return;
    setAnchorRect(searchRowRef.current?.getBoundingClientRect() ?? null);
    setOpen(true);
    setLoading(true);
    setError(null);
    setSelections({});
    initialSelectionsRef.current = {};
    try {
      const data = await searchAllColumns({ q });
      const nextResults = (data?.results || []).map((group) => ({
        ...group,
        total: group.total ?? group.count ?? group.matches.length,
      }));
      setResults(nextResults);
      const preselected = {};
      nextResults.forEach((group) => {
        const appliedValues = appliedFilters[canonicalColumn(group.column)]?.values;
        if (!appliedValues?.length) return;
        const appliedSet = new Set(appliedValues.map(String));
        group.matches.forEach((value) => {
          if (appliedSet.has(String(value))) {
            preselected[keyFor(group.column, group.paramName, value)] = {
              column: group.column,
              paramName: group.paramName,
              value,
            };
          }
        });
      });
      setSelections(preselected);
      initialSelectionsRef.current = preselected;
    } catch (e) {
      setError(e.message || 'Search failed. Try again.');
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const clearSearch = () => {
    setQuery('');
    setOpen(false);
    setResults([]);
    setSelections({});
  };

  const keyFor = (column, paramName, value) => `${column}||${paramName}||${value}`;

  const toggleSelection = (column, paramName, value) => {
    const key = keyFor(column, paramName, value);
    setSelections((prev) => {
      const next = { ...prev };
      if (next[key]) delete next[key];
      else next[key] = { column, paramName, value };
      return next;
    });
  };

  const isGroupFullySelected = (group) =>
    group.matches.length > 0 &&
    group.matches.every((value) => selections[keyFor(group.column, group.paramName, value)]);

  const isGroupPartiallySelected = (group) =>
    !isGroupFullySelected(group) &&
    group.matches.some((value) => selections[keyFor(group.column, group.paramName, value)]);

  const toggleGroupSelectAll = (group) => {
    const clearing = isGroupFullySelected(group);
    setSelections((prev) => {
      const next = { ...prev };
      group.matches.forEach((value) => {
        const key = keyFor(group.column, group.paramName, value);
        if (clearing) delete next[key];
        else next[key] = { column: group.column, paramName: group.paramName, value };
      });
      return next;
    });
  };

  const isAllResultsSelected = results.length > 0 && results.every(isGroupFullySelected);
  const isSomeResultsSelected =
    !isAllResultsSelected && results.some((group) => isGroupFullySelected(group) || isGroupPartiallySelected(group));

  const toggleSelectAllResults = () => {
    const clearing = isAllResultsSelected;
    setSelections((prev) => {
      const next = { ...prev };
      results.forEach((group) => {
        group.matches.forEach((value) => {
          const key = keyFor(group.column, group.paramName, value);
          if (clearing) delete next[key];
          else next[key] = { column: group.column, paramName: group.paramName, value };
        });
      });
      return next;
    });
  };

  const selCount = Object.keys(selections).length;
  const initialKeys = Object.keys(initialSelectionsRef.current);
  const hasChanges =
    initialKeys.length !== selCount || initialKeys.some((k) => !selections[k]);

  const applySelections = () => {
    if (!hasChanges) return;
    const matchedByColumn = {};
    results.forEach((group) => {
      matchedByColumn[group.column] = group.matches.map(String);
    });
    onApplySelections(Object.values(selections), matchedByColumn);
    clearSearch();
  };

  const handleBlur = () => {
    setTimeout(() => {
      if (wrapRef.current?.matches(':hover')) return;
      if (document.activeElement === inputRef.current) return;
      setOpen(false);
    }, 150);
  };

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  let dropdownStyle = null;
  let resultsStyle = null;
  if (open && anchorRect) {
    const viewportMargin = 8;
    const width = anchorRect.width;
    const left = Math.min(anchorRect.left, window.innerWidth - width - viewportMargin);
    const spaceBelow = window.innerHeight - anchorRect.bottom;
    const openUpward = spaceBelow < 260 && anchorRect.top > 260;
    dropdownStyle = openUpward
      ? { left, bottom: window.innerHeight - anchorRect.top + 6 }
      : { left, top: anchorRect.bottom + 6 };
    // The page itself never scrolls (body has overflow:hidden), so once a
    // drag pushes this fixed-position box past the visible viewport there's
    // no way to scroll and reveal the rest — it just silently disappears
    // off-screen, which reads as the resize "stopping" even though nothing
    // is actually capping it in CSS. Capping max-width/max-height here to
    // the real remaining space from this anchor point lets a drag reach
    // that true edge instead of overshooting into invisible territory.
    const maxWidth = window.innerWidth - left - viewportMargin;
    const maxHeight = openUpward
      ? anchorRect.top - 6 - viewportMargin
      : window.innerHeight - (anchorRect.bottom + 6) - viewportMargin;
    // Set on the results box itself (not the dropdown wrapper) so it starts
    // out matching the Filter Builder's width exactly, while the wrapper
    // (align-items: flex-start, no width of its own) just shrink-wraps
    // around it — that way dragging the results box's own resize handle
    // wider grows the wrapper along with it instead of being clipped by a
    // wrapper stuck at a fixed width.
    resultsStyle = { width, maxWidth, maxHeight };
  }

  return (
    <>
      {open && anchorRect && <div className="fb-search-overlay" />}
      <div className="fb-search-wrap" ref={wrapRef}>
        <span className="fb-label">Smart Search</span>
        <div className="fb-search-row" ref={searchRowRef}>
          <input
            ref={inputRef}
            type="text"
            className="fb-input"
            placeholder="Enter 3 characters to search..."
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && runSearch()}
            onBlur={handleBlur}
          />
          <button className="fb-search-btn" onClick={runSearch} disabled={loading} title="Search" aria-label="Search">
            {loading ? (
              <span className="fb-search-btn-spinner" aria-hidden="true" />
            ) : (
              <Search size={15} strokeWidth={2.5} aria-hidden="true" />
            )}
          </button>
          {query && (
            <button className="fb-search-clear-btn" onClick={clearSearch}>
              ✕
            </button>
          )}
        </div>
  
        {dropdownStyle && !loading && (
          <div className="fb-search-dropdown" style={dropdownStyle}>
            <div className="fb-search-results" style={resultsStyle}>
              {error && <div className="fb-search-no-results">{error}</div>}
              {!error && !results.length && (
                <div className="fb-search-no-results">
                  No matches for "<strong>{query}</strong>"
                </div>
              )}
              {!error &&
                results.map((group, idx) => (
                  <div key={group.column}>
                    <div className="fb-search-group-label">
                      <span>
                        {group.column}
                        {group.total > group.matches.length && (
                          <span style={{ fontWeight: 400, opacity: 0.6 }}>
                            {' '}
                            — {group.total} matches
                          </span>
                        )}
                      </span>
                      <label className="fb-search-group-select-all">
                        <input
                          type="checkbox"
                          checked={isGroupFullySelected(group)}
                          ref={(el) => {
                            if (el) el.indeterminate = isGroupPartiallySelected(group);
                          }}
                          onChange={() => toggleGroupSelectAll(group)}
                        />
                        All
                      </label>
                    </div>
                    {group.matches.map((val) => {
                      const key = keyFor(group.column, group.paramName, val);
                      // Distinguishes a match that was already one of the
                      // user's active filters (found via appliedFilters when
                      // the search ran) from one they're newly checking off
                      // in this search, so the two read as visually
                      // different states rather than one flat "selected".
                      const isAlreadyApplied = Boolean(initialSelectionsRef.current[key]);
                      return (
                        <label
                          key={key}
                          className={`fb-search-result-item${selections[key] ? ' selected' : ''}${
                            selections[key] && isAlreadyApplied ? ' already-applied' : ''
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={!!selections[key]}
                            onChange={() => toggleSelection(group.column, group.paramName, val)}
                          />
                          <span>
                            <HighlightedText text={val} query={query} />
                          </span>
                        </label>
                      );
                    })}
                    {idx < results.length - 1 && <hr className="fb-search-divider" />}
                  </div>
                ))}
            </div>
  
            {(selCount > 0 || hasChanges) && (
              <div className="fb-search-apply-bar">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span className="fb-search-sel-count">
                    {selCount > 0
                      ? `${selCount} value${selCount > 1 ? 's' : ''} selected`
                      : 'All matches deselected'}
                  </span>
                  <label className="fb-search-select-all-btn">
                    <input
                      type="checkbox"
                      checked={isAllResultsSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = isSomeResultsSelected;
                      }}
                      onChange={toggleSelectAllResults}
                    />
                    Select all
                  </label>
                </div>
                <button className="fb-search-apply-all" onClick={applySelections} disabled={!hasChanges}>
                  Apply filters
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

export default memo(SmartSearch);
