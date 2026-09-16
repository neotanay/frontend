import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useColumns } from '../../hooks/useColumns';
import { useColumnValues } from '../../hooks/useColumnValues';
import { useFilters } from '../../context/FilterContext';
import { parseNumericOp, valueMatchesOp, valuesMatch } from '../../utils/numericOps';
import ValuesList from './ValuesList';
import AppliedFilters from './AppliedFilters';
import SmartSearch from './SmartSearch';
import ColumnSelect from './ColumnSelect';
import './FilterBuilder.css';

function sameValues(a = [], b = []) {
  if (a.length !== b.length) return false;
  const left = [...a].map(String).sort();
  const right = [...b].map(String).sort();
  return left.every((v, i) => v === right[i]);
}

function resolveTextInput(rawText, knownValues) {
  const tokens = rawText
    .split(/[\n,]+/)
    .map((v) => v.trim())
    .filter(Boolean);

  const knownByLower = new Map(knownValues.map((v) => [String(v).toLowerCase(), v]));
  const resolved = new Set();

  tokens.forEach((tok) => {
    const opMatch = parseNumericOp(tok);
    if (opMatch) {
      const matches = knownValues.filter((v) => valueMatchesOp(v, opMatch.op, opMatch.num));
      matches.forEach((v) => resolved.add(String(v)));
      return;
    }

    const canonical = knownByLower.get(tok.toLowerCase());
    resolved.add(canonical !== undefined ? String(canonical) : tok);
  });

  return { values: [...resolved] };
}

export default function FilterBuilder({ onFilterApplied, onResetAll, onClearRow }) {
  const { columns, loading: columnsLoading } = useColumns();
  const {
    appliedFilters,
    canonicalColumn,
    paramForColumn,
    setColumnFilter,
    removeFilterValue,
    clearColumn,
  } = useFilters();

  const [selectedColumn, setSelectedColumn] = useState('');
  const [checkedValues, setCheckedValues] = useState([]);
  const [textInput, setTextInput] = useState('');
  const [status, setStatus] = useState({ msg: '', type: '' });
  const [valuesBoxRevealed, setValuesBoxRevealed] = useState(false);
  const prevValuesLoadingRef = useRef(false);

  const {
    allValues,
    displayedValues,
    hasMore,
    loadMore,
    loadingMore,
    loading: valuesLoading,
    error: valuesError,
    needsSearch,
    searchTerm,
    setSearchTerm,
    searchPending,
    isNumericColumn,
    columnInfo,
  } = useColumnValues(selectedColumn);

  const lastPushedValuesRef = useRef([]);

  useEffect(() => {
    setValuesBoxRevealed(false);
    prevValuesLoadingRef.current = false;
    if (!selectedColumn) {
      setCheckedValues([]);
      setTextInput('');
      lastPushedValuesRef.current = [];
      return;
    }
    const existing = appliedFilters[selectedColumn]?.values || [];
    setCheckedValues(existing);
    setTextInput('');
    setSearchTerm('');
    lastPushedValuesRef.current = existing;
  }, [selectedColumn]);

  useEffect(() => {
    if (!selectedColumn) return;
    const wasLoading = prevValuesLoadingRef.current;
    prevValuesLoadingRef.current = valuesLoading;
    if (needsSearch) {
      setValuesBoxRevealed(true);
      return;
    }
    if (wasLoading && !valuesLoading && !valuesError) {
      setValuesBoxRevealed(true);
    }
  }, [selectedColumn, valuesLoading, needsSearch, valuesError]);

  useEffect(() => {
    if (!selectedColumn) return;
    const current = appliedFilters[selectedColumn]?.values || [];
    if (sameValues(current, lastPushedValuesRef.current)) return;
    setCheckedValues(current);
    setTextInput('');
    lastPushedValuesRef.current = current;
  }, [appliedFilters, selectedColumn]);

  const { values: resolvedTyped } = useMemo(
    () => resolveTextInput(textInput, allValues),
    [textInput, allValues]
  );

  const totalSelected = useMemo(
    () => new Set([...checkedValues, ...resolvedTyped]).size,
    [checkedValues, resolvedTyped]
  );

  const allDisplayedChecked = useMemo(
    () =>
      displayedValues.length > 0 &&
      displayedValues.every((v) => checkedValues.some((cv) => valuesMatch(cv, v))),
    [displayedValues, checkedValues]
  );
  const someDisplayedChecked = useMemo(
    () =>
      !allDisplayedChecked &&
      displayedValues.some((v) => checkedValues.some((cv) => valuesMatch(cv, v))),
    [displayedValues, checkedValues, allDisplayedChecked]
  );
  const selectAllRef = useRef(null);
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someDisplayedChecked;
  }, [someDisplayedChecked]);

  const toggleValue = useCallback((v) => {
    setCheckedValues((prev) => {
      const idx = prev.findIndex((x) => valuesMatch(x, v));
      return idx !== -1 ? prev.filter((_, i) => i !== idx) : [...prev, v];
    });
  }, []);

  const toggleSelectAll = () => {
    const selectable = displayedValues.map(String);
    const anyUnchecked = selectable.some((v) => !checkedValues.some((cv) => valuesMatch(cv, v)));
    if (!anyUnchecked) {
      setCheckedValues([]);
      return;
    }
    const toAdd = selectable.filter((v) => !checkedValues.some((cv) => valuesMatch(cv, v)));
    setCheckedValues([...checkedValues, ...toAdd]);
  };

  const handleApply = () => {
    if (!selectedColumn) return;
    const paramName = paramForColumn(selectedColumn);
    if (!paramName) {
      setStatus({ msg: `No parameter for: ${selectedColumn}`, type: 'err' });
      return;
    }
    const values = [...new Set([...checkedValues, ...resolvedTyped])];

    if (!values.length) {
      if (!appliedFilters[selectedColumn]) return;
      lastPushedValuesRef.current = [];
      setColumnFilter(selectedColumn, [], paramName);
      onFilterApplied?.(selectedColumn, ['All']);
      setSelectedColumn('');
      setCheckedValues([]);
      setTextInput('');
      return;
    }

    lastPushedValuesRef.current = values;
    setColumnFilter(selectedColumn, values, paramName);
    onFilterApplied?.(selectedColumn, values);

    setSelectedColumn('');
    setCheckedValues([]);
    setTextInput('');
  };

  const handleClearAll = () => {
    setCheckedValues([]);
    setTextInput('');
    lastPushedValuesRef.current = [];
    onResetAll?.();
  };

  const handleRemoveValue = useCallback(
    (col, value) => {
      removeFilterValue(col, value);
      const remaining = (appliedFilters[col]?.values || []).filter((v) => String(v) !== value);
      onFilterApplied?.(col, remaining.length ? remaining : ['All']);
      if (selectedColumn === col) {
        lastPushedValuesRef.current = remaining;
        setCheckedValues((prev) => prev.filter((v) => v !== value));
      }
    },
    [removeFilterValue, appliedFilters, onFilterApplied, selectedColumn]
  );

  const handleClearColumnRow = useCallback(
    (col) => {
      const paramName = appliedFilters[col]?.paramName || paramForColumn(col);
      clearColumn(col);
      if (selectedColumn === col) {
        lastPushedValuesRef.current = [];
        setCheckedValues([]);
        setTextInput('');
      }
      onClearRow?.(col, paramName);
    },
    [appliedFilters, paramForColumn, clearColumn, selectedColumn, onClearRow]
  );

  const handleApplySearchSelections = useCallback(
    (selections, matchedByColumn = {}) => {
      // Smart Search results carry whatever column-name casing/spacing the /search
      // endpoint returned, which may not match the /columns-derived casing already
      // used as appliedFilters keys (e.g. from the sidebar Column dropdown). Canonicalize
      // here so both paths merge into the same entry instead of producing a duplicate.
      const byColumn = {};
      Object.entries(matchedByColumn).forEach(([rawCol, matchedValues]) => {
        const col = canonicalColumn(rawCol);
        const matchedSet = new Set(matchedValues.map(String));
        const existing = (appliedFilters[col]?.values || []).filter(
          (v) => !matchedSet.has(String(v))
        );
        byColumn[col] = {
          paramName: paramForColumn(col),
          values: new Set(existing),
        };
      });
      selections.forEach(({ column: rawColumn, value }) => {
        const column = canonicalColumn(rawColumn);
        if (!byColumn[column]) {
          byColumn[column] = {
            paramName: paramForColumn(column),
            values: new Set(appliedFilters[column]?.values || []),
          };
        }
        byColumn[column].values.add(value);
      });
      Object.entries(byColumn).forEach(([col, { paramName, values }]) => {
        const valuesArr = [...values];
        setColumnFilter(col, valuesArr, paramName);
        onFilterApplied?.(col, valuesArr.length ? valuesArr : ['All']);
      });
    },
    [paramForColumn, appliedFilters, setColumnFilter, onFilterApplied, canonicalColumn]
  );

  const appliedCount = Object.keys(appliedFilters).length;

  return (
    <div className="fb-panel">
      <div className="fb-title">
      </div>
      <SmartSearch onApplySelections={handleApplySearchSelections} />

      <div className="fb-col-panel-wrap">
      <span className="fb-label" style={{ marginTop: 6 }}>
        Column
      </span>
      <ColumnSelect
        columns={columns}
        value={selectedColumn}
        onChange={setSelectedColumn}
        disabled={columnsLoading}
      />

      {selectedColumn && columnInfo && columnInfo.filterable === false && (
        <div className="fb-val-warning">
          {selectedColumn} is a {columnInfo.dataType} column. Free-text columns cannot
          be listed as a value dropdown — type values below instead.
        </div>
      )}

      {selectedColumn && (
        <div className="fb-values-wrap">
          <div className="fb-val-header">
            <span>
              {selectedColumn}
              {typeof columnInfo?.numDistinct === 'number' && (
                <span className="fb-val-header-count">
                  ({columnInfo.numDistinct.toLocaleString()})
                </span>
              )}
            </span>
            <label className="fb-select-all">
              <input
                type="checkbox"
                ref={selectAllRef}
                checked={allDisplayedChecked}
                onChange={toggleSelectAll}
                disabled={!displayedValues.length}
              />
              All
            </label>
          </div>
          {valuesBoxRevealed && (
            <input
              type="text"
              className="fb-combined-search"
              placeholder={
                isNumericColumn ? 'Search, or type >, <, =' : 'Search values...'
              }
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          )}
          {needsSearch ? (
            <div className="fb-val-empty">
              This column has
              {columnInfo?.numDistinct
                ? ` about ${columnInfo.numDistinct.toLocaleString()} `
                : ' too many '}
              distinct values to list. Type at least 2 characters above to search it.
            </div>
          ) : valuesError ? (
            <div className="fb-val-warning">{valuesError}</div>
          ) : (
            <ValuesList
              values={displayedValues}
              checkedValues={checkedValues}
              onToggleValue={toggleValue}
              loading={valuesLoading || searchPending}
            />
          )}
          {hasMore && (
            <div className="fb-load-more-wrap">
              <button type="button" className="fb-load-more-btn" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}

          <div className="fb-divider-or">or type values</div>
          <textarea
            className="fb-text-area"
            placeholder="(comma or newline separated)"
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
          />
          <div className="fb-combined-count-row">
            <span className="fb-combined-count">
              {totalSelected > 0 ? `${totalSelected} value${totalSelected > 1 ? 's' : ''} selected` : ''}
            </span>
            {(totalSelected > 0 || appliedFilters[selectedColumn]) && (
              <button
                type="button"
                className="fb-btn fb-btn-apply fb-combined-apply-btn"
                onClick={handleApply}
              >
                Apply filter
              </button>
            )}
          </div>
        </div>
      )}
      </div>

      {status.msg && <div className={`fb-status ${status.type}`}>{status.msg}</div>}

      {/* <hr className="fb-hr" /> */}

      <AppliedFilters
        onRemoveValue={handleRemoveValue}
        onClearColumn={handleClearColumnRow}
        onClearAll={handleClearAll}
      />
    </div>
  );
}
