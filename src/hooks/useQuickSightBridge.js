import { useCallback, useRef } from 'react';
import { useFilters } from '../context/FilterContext';

const ALL_TOKENS = new Set(['', 'all', 'select all', '__all__', 'all values']);

function normalizeIncomingValues(values) {
  if (values == null) return [];
  const list = Array.isArray(values) ? values : [values];
  const cleaned = list.filter((v) => v != null).map(String);
  if (!cleaned.length) return [];
  if (cleaned.every((v) => ALL_TOKENS.has(v.trim().toLowerCase()))) return [];
  return cleaned;
}

export function useQuickSightBridge(embedRef) {
  const {
    applyExternalFilters,
    columnForParam,
    isControlParam,
    paramsForColumn,
    appliedFilters,
    setAppliedFilters,
    setColumnFilter,
  } = useFilters();

  const recentlySentRef = useRef(new Map());

  const resetGenerationRef = useRef(0);

  const markSent = useCallback((paramName) => {
    const timers = recentlySentRef.current;
    const existing = timers.get(paramName);
    if (existing) clearTimeout(existing);
    timers.set(
      paramName,
      setTimeout(() => timers.delete(paramName), 800)
    );
  }, []);

  const sendToQuickSight = useCallback(
    (paramNameOrColumn, values) => {
      const dashboard = embedRef.current;
      if (!dashboard) {
        console.warn('[qs-bridge] dashboard not ready, dropping update:', paramNameOrColumn, values);
        return;
      }
      if (!paramNameOrColumn) return;

      const targets = isControlParam(paramNameOrColumn)
        ? [paramNameOrColumn]
        : paramsForColumn(paramNameOrColumn);

      try {
        const params = targets.map((name) => {
          markSent(name);
          return { Name: name, Values: values };
        });
        console.log('[qs-bridge] sendToQuickSight -> setParameters:', { paramNameOrColumn, params });
        dashboard.setParameters(params);
      } catch (e) {
        console.error('[qs-bridge] setParameters failed:', e);
      }
    },
    [embedRef, isControlParam, paramsForColumn, markSent]
  );

  const handleParametersChanged = useCallback(
    (changedParameters, eventName) => {
      console.debug('[qs-bridge] handleParametersChanged received:', eventName, changedParameters);

      if (eventName && eventName !== 'PARAMETERS_CHANGED') return;

      const changed = Array.isArray(changedParameters) ? changedParameters : [];
      if (!changed.length) return;

      const updates = [];
      const ignored = [];
      const skipped = [];

      changed.forEach((p) => {
        try {
          const paramName = p?.Name ?? p?.name;
          const paramValues = p?.Values ?? p?.values;
          if (!paramName) {
            skipped.push(p);
            return;
          }

          if (!isControlParam(paramName)) {
            ignored.push(paramName);
            return;
          }

          if (recentlySentRef.current.has(paramName)) {
            console.debug('[qs-bridge] suppressed own echo:', paramName);
            return;
          }

          const column = columnForParam(paramName);
          if (!column) {
            skipped.push(p);
            return;
          }

          updates.push({
            column,
            paramName,
            values: normalizeIncomingValues(paramValues),
          });
        } catch (e) {
          console.error('[qs-bridge] failed to process parameter, skipping it:', p, e);
        }
      });

      if (skipped.length) {
        console.warn(
          '[qs-bridge] skipped parameters with no usable Name/column (unexpected shape?):',
          skipped
        );
      }
      if (ignored.length) {
        console.debug(
          '[qs-bridge] ignored non-control parameters (not found in /columns paramMap):',
          ignored.join(', ')
        );
      }
      if (updates.length) {
        console.debug('[qs-bridge] applying external updates from QuickSight:', updates);
        applyExternalFilters(updates);
      }
    },
    [applyExternalFilters, columnForParam, isControlParam]
  );

  // Replaces (not merges into) appliedFilters with only the columns backed
  // by one of these QuickSight parameters — used by resetAll so "Clear all"
  // keeps the dashboard's own default values instead of wiping them too.
  const applyDefaultsToAppliedFilters = useCallback(
    (paramsList) => {
      const defaultsByColumn = {};
      (Array.isArray(paramsList) ? paramsList : []).forEach((p) => {
        const paramName = p?.Name ?? p?.name;
        if (!paramName || !isControlParam(paramName)) return;
        const column = columnForParam(paramName);
        if (!column) return;
        const values = normalizeIncomingValues(p?.Values ?? p?.values);
        if (!values.length) return;
        defaultsByColumn[column] = { values, paramName };
      });
      setAppliedFilters(defaultsByColumn);
    },
    [isControlParam, columnForParam, setAppliedFilters]
  );

  const resetAll = useCallback(async () => {
    const dashboard = embedRef.current;
    if (!dashboard) return;
    const generation = ++resetGenerationRef.current;
    const cachedDefaults = dashboard.getDefaultParameters?.() || [];
    applyDefaultsToAppliedFilters(cachedDefaults);

    try {
      await dashboard.reset?.();
    } catch (e) {
      console.error('[qs-bridge] dashboard.reset() failed:', e);
    }

    const delaysMs = [0, 400, 900, 1600];
    for (const delay of delaysMs) {
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      if (generation !== resetGenerationRef.current) return;
      try {
        const params = await dashboard.getParameters();
        if (generation !== resetGenerationRef.current) return;
        if (params?.length) {
          applyDefaultsToAppliedFilters(params);
        }
      } catch (e) {
        console.error('[qs-bridge] getParameters after reset failed:', e);
      }
    }
  }, [embedRef, applyDefaultsToAppliedFilters]);

  const resetAndApply = useCallback(
    async (remaining) => {
      const dashboard = embedRef.current;
      if (!dashboard) return;
      try {
        await dashboard.reset();
        const params = [];
        Object.entries(remaining || {}).forEach(([key, values]) => {
          if (!key || key === 'undefined') return;
          const targets = isControlParam(key) ? [key] : paramsForColumn(key);
          targets.forEach((name) => {
            markSent(name);
            params.push({ Name: name, Values: values });
          });
        });
        if (params.length) dashboard.setParameters(params);
        Object.entries(remaining || {}).forEach(([key, values]) => {
          if (!key || key === 'undefined' || !values?.length) return;
          const column = columnForParam(key) || key;
          setColumnFilter(column, values, key);
        });
      } catch (e) {
        console.error('[qs-bridge] resetAndApply failed:', e);
      }
    },
    [embedRef, isControlParam, paramsForColumn, markSent, columnForParam, setColumnFilter]
  );

  return {
    sendToQuickSight,
    resetAll,
    resetAndApply,
    handleParametersChanged,
    appliedFilters,
  };
}
