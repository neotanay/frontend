import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { buildParamIndex, normalizeParamMap } from '../utils/paramMap';
import { loadColumnDatasetMap } from '../utils/columnDatasetMap';

function filterGroupColumnsFromDatasetMap(datasetMap) {
  const cols = new Set();
  Object.entries(datasetMap).forEach(([col, entries]) => {
    if (Array.isArray(entries) && entries.length && entries.every((e) => !e.parameter)) {
      cols.add(col);
    }
  });
  return cols;
}

function parseDefaultFilterValues(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    console.warn('[filterGroups] VITE_DEFAULT_FILTER_VALUES is not valid JSON, ignoring it:', raw);
    return {};
  }
}
const DEFAULT_FILTER_VALUES = parseDefaultFilterValues(import.meta.env.VITE_DEFAULT_FILTER_VALUES);

const FilterContext = createContext(null);

function sameValues(a = [], b = []) {
  if (a.length !== b.length) return false;
  const left = [...a].map(String).sort();
  const right = [...b].map(String).sort();
  return left.every((v, i) => v === right[i]);
}

export function FilterProvider({ children }) {
  const [appliedFilters, setAppliedFilters] = useState({});
  const [columnToParams, setColumnToParams] = useState({});
  const [paramToColumn, setParamToColumn] = useState({});
  const [numericColumns, setNumericColumns] = useState(new Set());
  const [columnMeta, setColumnMeta] = useState({});
  const [filterGroupColumns, setFilterGroupColumns] = useState(() => new Set());
  const [columnDatasetMap, setColumnDatasetMap] = useState({});
  const [datasetMap, setDatasetMap] = useState({});
  const [crossDatasetColumns, setCrossDatasetColumns] = useState(new Set());
  const [defaultDatasetIdentifier, setDefaultDatasetIdentifier] = useState('');
  const backendFilterGroupColumnsLoadedRef = useRef(false);

  const [defaultFilterValues] = useState(() => DEFAULT_FILTER_VALUES);
  const [defaultFilterColumns] = useState(() => new Set(Object.keys(DEFAULT_FILTER_VALUES)));

  useEffect(() => {
    let cancelled = false;
    loadColumnDatasetMap().then((map) => {
      if (cancelled) return;
      setColumnDatasetMap(map);
      if (!backendFilterGroupColumnsLoadedRef.current) {
        setFilterGroupColumns(filterGroupColumnsFromDatasetMap(map));
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadParamMap = useCallback((data) => {
    const { columnToParams: c2p, paramToColumn: p2c, reversed } = normalizeParamMap(data);
    if (reversed) {
      console.info('[paramMap] API returned param -> column; normalized to column -> param');
    }
    setColumnToParams(c2p);
    setParamToColumn(p2c);
    if (Array.isArray(data?.filterGroupColumns)) {
      backendFilterGroupColumnsLoadedRef.current = true;
      setFilterGroupColumns(new Set(data.filterGroupColumns.map(String)));
      console.log('[filterGroups] filterGroupColumns loaded from backend:', data.filterGroupColumns);
    } else {
      setFilterGroupColumns((prev) => {
        console.warn(
          '[filterGroups] Backend /columns had no "filterGroupColumns" array — keeping the hardcoded fallback',
          [...prev]
        );
        return prev;
      });
    }
    if (data?.datasetMap && typeof data.datasetMap === 'object') {
      setDatasetMap(data.datasetMap);
      console.log('[filterGroups] datasetMap loaded from backend:', data.datasetMap);
    } else {
      console.warn(
        '[filterGroups] Backend /columns had no "datasetMap" object — FilterGroups columns will fall back to the S3 column_dataset_map.json / default dataset identifier'
      );
    }
    if (Array.isArray(data?.crossDatasetColumns)) {
      setCrossDatasetColumns(new Set(data.crossDatasetColumns.map(String)));
      console.log('[filterGroups] crossDatasetColumns loaded from backend:', data.crossDatasetColumns);
    } else {
      console.warn(
        '[filterGroups] Backend /columns had no "crossDatasetColumns" array — every FilterGroups column will use CrossDataset: SINGLE_DATASET'
      );
    }
    if (typeof data?.defaultDatasetIdentifier === 'string' && data.defaultDatasetIdentifier) {
      setDefaultDatasetIdentifier(data.defaultDatasetIdentifier);
    }
  }, []);

  const paramIndex = useMemo(() => buildParamIndex(paramToColumn), [paramToColumn]);

  // Different backend endpoints (e.g. /columns vs /search) don't always agree on the
  // exact casing/whitespace of a column name. Without normalizing, the same column
  // reached via two different UI paths (Smart Search vs the Column dropdown) would be
  // stored under two different appliedFilters keys and show up as duplicate rows even
  // though the labels render identically (the UI uppercases them via CSS). This index
  // maps any casing/whitespace variant back to the one canonical spelling so every
  // caller ends up keying appliedFilters the same way.
  const columnKeyIndex = useMemo(() => {
    const map = new Map();
    const register = (col) => {
      const key = String(col).trim().toLowerCase();
      if (!map.has(key)) map.set(key, col);
    };
    Object.keys(columnToParams).forEach(register);
    Object.keys(columnDatasetMap).forEach(register);
    filterGroupColumns.forEach(register);
    return map;
  }, [columnToParams, columnDatasetMap, filterGroupColumns]);

  const canonicalColumn = useCallback(
    (column) => {
      if (!column) return column;
      return columnKeyIndex.get(String(column).trim().toLowerCase()) || column;
    },
    [columnKeyIndex]
  );

  const paramsForColumn = useCallback(
    (column) => {
      const col = canonicalColumn(column);
      return columnToParams[col] || [col];
    },
    [columnToParams, canonicalColumn]
  );

  const paramForColumn = useCallback(
    (column) => paramsForColumn(column)[0],
    [paramsForColumn]
  );

  const columnForParam = useCallback(
    (param) => paramIndex.get(String(param).toLowerCase())?.column || null,
    [paramIndex]
  );

  const isControlParam = useCallback(
    (param) => Boolean(param) && paramIndex.has(String(param).toLowerCase()),
    [paramIndex]
  );

  const isFilterGroupColumn = useCallback(
    (column) => filterGroupColumns.has(canonicalColumn(column)),
    [filterGroupColumns, canonicalColumn]
  );

  const isDefaultFilterColumn = useCallback(
    (column) => defaultFilterColumns.has(canonicalColumn(column)),
    [defaultFilterColumns, canonicalColumn]
  );

  const getDefaultFilterValue = useCallback(
    (column) => {
      const raw = defaultFilterValues[canonicalColumn(column)];
      return raw == null ? null : [String(raw)];
    },
    [defaultFilterValues, canonicalColumn]
  );

  const setColumnFilter = useCallback((rawCol, values, paramName) => {
    const col = canonicalColumn(rawCol);
    setAppliedFilters((prev) => {
      if (!values || !values.length) {
        if (!prev[col]) return prev;
        const next = { ...prev };
        delete next[col];
        return next;
      }
      const nextValues = values.map(String);
      const existing = prev[col];
      const nextParam = paramName || existing?.paramName || col;
      if (existing && existing.paramName === nextParam && sameValues(existing.values, nextValues)) {
        return prev;
      }
      return {
        ...prev,
        [col]: { values: nextValues, paramName: nextParam },
      };
    });
  }, [canonicalColumn]);

  const applyExternalFilters = useCallback((updates) => {
    if (!updates?.length) return;
    setAppliedFilters((prev) => {
      let changed = false;
      const next = { ...prev };

      updates.forEach(({ column: rawColumn, values, paramName }) => {
        if (!rawColumn) return;
        const column = canonicalColumn(rawColumn);
        if (!values || !values.length) {
          if (next[column]) {
            delete next[column];
            changed = true;
          }
          return;
        }
        const nextValues = values.map(String);
        const nextParam = paramName || next[column]?.paramName || column;
        const existing = next[column];
        if (existing && existing.paramName === nextParam && sameValues(existing.values, nextValues)) {
          return;
        }
        next[column] = { values: nextValues, paramName: nextParam };
        changed = true;
      });

      return changed ? next : prev;
    });
  }, [canonicalColumn]);

  const removeFilterValue = useCallback((rawCol, value) => {
    const col = canonicalColumn(rawCol);
    setAppliedFilters((prev) => {
      const existing = prev[col];
      if (!existing) return prev;
      const values = existing.values.filter((v) => String(v) !== String(value));
      const next = { ...prev };
      if (!values.length) {
        delete next[col];
      } else {
        next[col] = { ...existing, values };
      }
      return next;
    });
  }, [canonicalColumn]);

  const clearColumn = useCallback((rawCol) => {
    const col = canonicalColumn(rawCol);
    setAppliedFilters((prev) => {
      if (!prev[col]) return prev;
      const next = { ...prev };
      delete next[col];
      return next;
    });
  }, [canonicalColumn]);

  const clearAllFilters = useCallback(() => {
    setAppliedFilters({});
  }, []);

  const buildPreviousFilters = useCallback(
    (excludeColumn) =>
      Object.entries(appliedFilters)
        .filter(([col]) => col !== excludeColumn)
        .map(([col, f]) => ({ column_name: col, values: f.values })),
    [appliedFilters]
  );

  const value = useMemo(
    () => ({
      appliedFilters,
      setAppliedFilters,
      columnToParams,
      paramToColumn,
      loadParamMap,
      canonicalColumn,
      paramsForColumn,
      paramForColumn,
      columnForParam,
      isControlParam,
      numericColumns,
      setNumericColumns,
      columnMeta,
      setColumnMeta,
      filterGroupColumns,
      isFilterGroupColumn,
      defaultFilterColumns,
      isDefaultFilterColumn,
      defaultFilterValues,
      getDefaultFilterValue,
      columnDatasetMap,
      datasetMap,
      crossDatasetColumns,
      defaultDatasetIdentifier,
      setColumnFilter,
      applyExternalFilters,
      removeFilterValue,
      clearColumn,
      clearAllFilters,
      buildPreviousFilters,
    }),
    [
      appliedFilters,
      columnToParams,
      paramToColumn,
      loadParamMap,
      canonicalColumn,
      paramsForColumn,
      paramForColumn,
      columnForParam,
      isControlParam,
      numericColumns,
      columnMeta,
      filterGroupColumns,
      isFilterGroupColumn,
      defaultFilterColumns,
      isDefaultFilterColumn,
      defaultFilterValues,
      getDefaultFilterValue,
      columnDatasetMap,
      datasetMap,
      crossDatasetColumns,
      defaultDatasetIdentifier,
      setColumnFilter,
      applyExternalFilters,
      removeFilterValue,
      clearColumn,
      clearAllFilters,
      buildPreviousFilters,
    ]
  );

  return <FilterContext.Provider value={value}>{children}</FilterContext.Provider>;
}

export function useFilters() {
  const ctx = useContext(FilterContext);
  if (!ctx) throw new Error('useFilters must be used within a FilterProvider');
  return ctx;
}
