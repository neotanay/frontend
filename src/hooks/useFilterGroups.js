import { useCallback, useEffect, useRef } from 'react';
import { useFilters } from '../context/FilterContext';

const FALLBACK_QS_DATASET_IDENTIFIER = import.meta.env.VITE_QS_DATASET_IDENTIFIER || '';
const POLL_INTERVAL_MS = 10000;

function datasetIdentifierNamesForColumn(columnDatasetMap, col) {
  const entries = columnDatasetMap[col];
  if (!Array.isArray(entries) || !entries.length) return [];
  const names = entries.map((e) => e.dataset_identifier_name).filter(Boolean);
  return [...new Set(names)];
}

function isFilterGroupTranslationNoise(reason) {
  if (!reason) return false;
  if (reason.name === 'FilterGroupTranslationError') return true;
  const message = typeof reason === 'string' ? reason : reason.message || '';
  return message.includes('FilterGroupTranslationError') || message.includes('no valid visual ids');
}

function extractBrokenFilterGroupId(reason) {
  if (!reason) return null;
  const blob = `${reason.stack || ''} ${reason.message || ''}`;
  const match = blob.match(/"filterGroupId"\s*:\s*"([^"]+)"/);
  return match ? match[1] : null;
}

const GET_FILTER_GROUPS_TIMEOUT_MS = 4000;
const FETCH_TIMED_OUT = Symbol('filter-groups-fetch-timed-out');
async function getFilterGroupsForSheetSafe(dashboard, sheetId) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(FETCH_TIMED_OUT), GET_FILTER_GROUPS_TIMEOUT_MS);
  });
  try {
    const result = await Promise.race([dashboard.getFilterGroupsForSheet(sheetId), timeout]);
    if (result === FETCH_TIMED_OUT) {
      console.warn(
        '[filter-groups] getFilterGroupsForSheet did not settle within',
        GET_FILTER_GROUPS_TIMEOUT_MS,
        'ms -- likely a stray unparseable native FilterGroup on this sheet ' +
          '(FilterGroupTranslationError / "no valid visual ids"). Proceeding as ' +
          'if none were found this round instead of hanging.'
      );
      return [];
    }
    return result || [];
  } finally {
    clearTimeout(timer);
  }
}

export function useFilterGroups(embedRef, dashboardReady) {
  const {
    filterGroupColumns,
    columnDatasetMap,
    datasetMap,
    crossDatasetColumns,
    defaultDatasetIdentifier,
    setColumnFilter,
    clearColumn,
  } = useFilters();

  const sheetIdRef = useRef(null);
  const nativeFilterGroupIdRef = useRef({});
  const nativeFilterIdRef = useRef({});
  const nativeDatasetIdRef = useRef({});
  const nativeCrossDatasetRef = useRef({});
  const knownFilterGroupsRef = useRef({});
  // Snapshot of each native FilterGroup column's value as first discovered
  // (e.g. MED_YN/NONMED_YN's "Y"), captured once and never overwritten.
  // Some of these dropdown Controls have no "All" option authored in
  // QuickSight -- disabling their FilterGroup to empty just leaves the
  // control blank instead of showing "All" like other columns do. Clearing
  // one of these columns re-applies this default instead of blanking it.
  const defaultFilterGroupValuesRef = useRef({});
  const knownGroupIdsRef = useRef({});
  const pendingRef = useRef([]);
  const readyRef = useRef(false);
  const pollBusyRef = useRef(false);
  const autoHealedIdsRef = useRef(new Set());


  const datasetIdentifiersFor = useCallback(
    (col) => {
      if (nativeDatasetIdRef.current[col]) return [nativeDatasetIdRef.current[col]];
      if (datasetMap[col]) return [datasetMap[col]];
      if (defaultDatasetIdentifier) return [defaultDatasetIdentifier];
      const names = datasetIdentifierNamesForColumn(columnDatasetMap, col);
      return names.length ? names : [FALLBACK_QS_DATASET_IDENTIFIER];
    },
    [datasetMap, defaultDatasetIdentifier, columnDatasetMap]
  );

  const groupTargetsForColumn = useCallback(
    (col) => {
      const identifiers = datasetIdentifiersFor(col);
      return identifiers.map((datasetIdentifier) => ({
        datasetIdentifier,
        groupId:
          nativeFilterGroupIdRef.current[col] ||
          (identifiers.length > 1 ? `fg_${col}__${datasetIdentifier}` : `fg_${col}`),
      }));
    },
    [datasetIdentifiersFor]
  );

  const crossDatasetFor = useCallback(
    (col) => {
      if (Object.prototype.hasOwnProperty.call(nativeCrossDatasetRef.current, col)) {
        return nativeCrossDatasetRef.current[col];
      }
      return crossDatasetColumns.has(col) ? 'ALL_DATASETS' : 'SINGLE_DATASET';
    },
    [crossDatasetColumns]
  );

  const resolveSheetId = useCallback(async () => {
    const dashboard = embedRef.current;
    if (!dashboard) return null;
    try {
      const id = await dashboard.getSelectedSheetId();
      if (id) return id;
    } catch (e) {
    }
    try {
      const sheets = await dashboard.getSheets();
      const first = Array.isArray(sheets) ? sheets[0] : null;
      return first ? first.SheetId || first.Id || null : null;
    } catch (e) {
      console.error('[filter-groups] failed to resolve sheet id:', e.message);
      return null;
    }
  }, [embedRef]);

  
  const buildCategoryFilterGroup = useCallback(
    (col, values, status, groupId, datasetIdentifier) => {
      return {
        FilterGroupId: groupId,
        Filters: [
          {
            CategoryFilter: {
              Column: { ColumnName: col, DataSetIdentifier: datasetIdentifier },
              FilterId: nativeFilterIdRef.current[col] || groupId,
              Configuration: {
                FilterListConfiguration: {
                  MatchOperator: 'CONTAINS',
                  NullOption: 'NON_NULLS_ONLY',
                  CategoryValues: values.map(String),
                },
              },
            },
          },
        ],
        ScopeConfiguration: {
          AllSheets: {}
        },
        CrossDataset: crossDatasetFor(col),
        Status: status,
      };
    },
    [crossDatasetFor]
  );

  const buildCategoryFilterGroupsForColumn = useCallback(
    (col, values, status) =>
      groupTargetsForColumn(col).map(({ groupId, datasetIdentifier }) =>
        buildCategoryFilterGroup(col, values, status, groupId, datasetIdentifier)
      ),
    [groupTargetsForColumn, buildCategoryFilterGroup]
  );

  const discoverNativeFilterGroups = useCallback(async () => {
    const dashboard = embedRef.current;
    if (!dashboard || !sheetIdRef.current) return;
    try {
      const groups = await getFilterGroupsForSheetSafe(dashboard, sheetIdRef.current);
      console.log(
        '[filter-groups] FilterGroups present on sheet:',
        (groups || []).map((g) => ({
          FilterGroupId: g.FilterGroupId,
          column: g.Filters?.[0]?.CategoryFilter?.Column?.ColumnName,
          dataSetIdentifier: g.Filters?.[0]?.CategoryFilter?.Column?.DataSetIdentifier,
        }))
      );
      (groups || []).forEach((g) => {
        const cf = g.Filters?.[0]?.CategoryFilter;
        const colName = cf?.Column?.ColumnName;
        console.log("filterGroupColumns ", filterGroupColumns)
        if (!colName || !filterGroupColumns.has(colName) || nativeFilterGroupIdRef.current[colName]) {
          return;
        }
        nativeFilterGroupIdRef.current[colName] = g.FilterGroupId;
        nativeFilterIdRef.current[colName] = cf.FilterId || g.FilterGroupId;
        if (cf.Column?.DataSetIdentifier) {
          nativeDatasetIdRef.current[colName] = cf.Column.DataSetIdentifier;
        }
        if (g.CrossDataset) {
          nativeCrossDatasetRef.current[colName] = g.CrossDataset;
        }
        const vals =
          g.Status !== 'DISABLED' ? cf.Configuration?.FilterListConfiguration?.CategoryValues || [] : [];
        const stringVals = vals.map(String);
        knownFilterGroupsRef.current[colName] = stringVals;
        if (stringVals.length) {
          defaultFilterGroupValuesRef.current[colName] = stringVals;
        }
        // discoverNativeFilterGroups only runs once per column (guarded by
        // nativeFilterGroupIdRef above), right when a fresh embed session
        // adopts a pre-existing FilterGroup -- e.g. after a page reload.
        // Without pushing it into appliedFilters here, the sidebar has no
        // way to know this filter exists until something else touches it.
        setColumnFilter(colName, stringVals, colName);
        console.log(`[filter-groups] adopted native FilterGroup for "${colName}":`, vals);
      });
    } catch (e) {
      console.error('[filter-groups] discoverNativeFilterGroups failed:', e.message);
    }
  }, [embedRef, filterGroupColumns, setColumnFilter]);

  const cleanupStaleFilterGroups = useCallback(async () => {
    const dashboard = embedRef.current;
    if (!dashboard || !sheetIdRef.current) return;
    const nonNative = [...filterGroupColumns].filter((c) => !nativeFilterGroupIdRef.current[c]);
    if (!nonNative.length) return;
    const ownGroupIds = new Set();
    nonNative.forEach((c) => {
      groupTargetsForColumn(c).forEach(({ groupId }) => ownGroupIds.add(groupId));
    });
    try {
      const existing = await getFilterGroupsForSheetSafe(dashboard, sheetIdRef.current);
      const staleIds = (existing || [])
        .filter((g) => ownGroupIds.has(g.FilterGroupId))
        .map((g) => g.FilterGroupId);
      if (staleIds.length) {
        await dashboard.removeFilterGroups(staleIds);
        console.log('[filter-groups] cleared', staleIds.length, 'auto-restored FilterGroup(s):', staleIds);
      }
    } catch (e) {
      console.error('[filter-groups] cleanupStaleFilterGroups failed:', e.message);
    }
  }, [embedRef, filterGroupColumns, groupTargetsForColumn]);

  const applyColumnFilter = useCallback(
    async (col, values) => {
      const dashboard = embedRef.current;
      if (!dashboard || !sheetIdRef.current || !readyRef.current) {
        pendingRef.current.push({ col, values });
        return;
      }

      const known = knownFilterGroupsRef.current;
      const existed = Object.prototype.hasOwnProperty.call(known, col);
      const isNative = Boolean(nativeFilterGroupIdRef.current[col]);
      const existingGroupIds = knownGroupIdsRef.current[col] || new Set();

      try {
        if (!values.length) {
          if (existed) {
            if (isNative) {
              const fallbackDefault = defaultFilterGroupValuesRef.current[col];
              if (fallbackDefault?.length) {
                const groups = buildCategoryFilterGroupsForColumn(col, fallbackDefault, 'ENABLED');
                await dashboard.updateFilterGroups(groups);
                known[col] = fallbackDefault;
                values = fallbackDefault;
              } else {
                const groups = buildCategoryFilterGroupsForColumn(col, known[col] || [], 'DISABLED');
                await dashboard.updateFilterGroups(groups);
                known[col] = [];
              }
            } else {
              const idsToRemove = [...existingGroupIds];
              if (idsToRemove.length) await dashboard.removeFilterGroups(idsToRemove);
              delete known[col];
              delete knownGroupIdsRef.current[col];
            }
          }
        } else {
          const targets = groupTargetsForColumn(col);
          const groups = targets.map(({ groupId, datasetIdentifier }) =>
            buildCategoryFilterGroup(col, values, 'ENABLED', groupId, datasetIdentifier)
          );
          const toUpdate = isNative ? groups : groups.filter((g) => existingGroupIds.has(g.FilterGroupId));
          const toAdd = isNative ? [] : groups.filter((g) => !existingGroupIds.has(g.FilterGroupId));
          if (toUpdate.length) {
            console.log(`[filter-groups] updateFilterGroups payload for "${col}":`, toUpdate);
            await dashboard.updateFilterGroups(toUpdate);
          }
          if (toAdd.length) {
            console.log(`[filter-groups] addFilterGroups payload for "${col}":`, toAdd);
            await dashboard.addFilterGroups(toAdd);
          }
          known[col] = [...values];
          knownGroupIdsRef.current[col] = new Set(targets.map((t) => t.groupId));
        }
      } catch (e) {
        const reason = typeof e === 'string' ? e : e?.message || e;
        console.error(`[filter-groups] applyColumnFilter failed for "${col}":`, reason, e);
        console.error(`[filter-groups] sheetId at failure time was:`, sheetIdRef.current);
        // Commonly caused by a stray unparseable native FilterGroup elsewhere on the
        // sheet failing the SDK's whole-sheet validation. Re-queue so it gets retried
        // automatically once the unhandledrejection handler below removes the culprit.
        pendingRef.current.push({ col, values });
        return;
      }
      setColumnFilter(col, values, col);
    },
    [embedRef, buildCategoryFilterGroup, buildCategoryFilterGroupsForColumn, groupTargetsForColumn, setColumnFilter]
  );

  const flushPendingUpdates = useCallback(async () => {
    if (!pendingRef.current.length) return;
    const queued = pendingRef.current.splice(0, pendingRef.current.length);
    for (const { col, values } of queued) {
      await applyColumnFilter(col, values);
    }
  }, [applyColumnFilter]);

  useEffect(() => {
    const handleUnhandledRejection = (event) => {
      if (!isFilterGroupTranslationNoise(event.reason)) return;
      event.preventDefault();

      const dashboard = embedRef.current;
      const brokenId = extractBrokenFilterGroupId(event.reason);

      if (!brokenId || autoHealedIdsRef.current.has(brokenId) || !dashboard) {
        console.warn(
          '[filter-groups] suppressed a known SDK limitation: this sheet has a native ' +
            'FilterGroup the embedding SDK cannot parse (commonly a reader-added ' +
            '"exploration" filter left scoped to no visuals). Discovery/cleanup/polling ' +
            'will keep retrying on schedule, but the actual fix is removing that stray ' +
            'FilterGroup from the dashboard or analysis in QuickSight.'
        );
        return;
      }

      autoHealedIdsRef.current.add(brokenId);
      console.warn(
        `[filter-groups] auto-removing unparseable native FilterGroup "${brokenId}" -- ` +
          'it has no valid visual ids and was failing whole-sheet validation for every ' +
          'addFilterGroups/updateFilterGroups call. Retrying pending updates after removal.'
      );
      dashboard
        .removeFilterGroups([brokenId])
        .then(() => Promise.all([discoverNativeFilterGroups(), cleanupStaleFilterGroups()]))
        .then(() => flushPendingUpdates())
        .then(() => {
          console.warn(`[filter-groups] auto-heal complete for "${brokenId}"; sync should resume.`);
        })
        .catch((err) => {
          console.error(
            `[filter-groups] auto-removal of broken FilterGroup "${brokenId}" failed:`,
            err?.message || err
          );
        });
    };
    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    return () => window.removeEventListener('unhandledrejection', handleUnhandledRejection);
  }, [embedRef, discoverNativeFilterGroups, cleanupStaleFilterGroups, flushPendingUpdates]);

  const clearAllKnownFilterGroups = useCallback(async () => {
    const dashboard = embedRef.current;
    const known = knownFilterGroupsRef.current;
    const cols = Object.keys(known);
    if (!dashboard || !cols.length) return;
    const nativeCols = cols.filter((c) => nativeFilterGroupIdRef.current[c]);
    const ownCols = cols.filter((c) => !nativeFilterGroupIdRef.current[c]);
    // Same reasoning as applyColumnFilter above: some native dropdown
    // Controls (e.g. MED_YN/NONMED_YN) have no "All" option authored in
    // QuickSight, so disabling them to empty just leaves them blank. Those
    // get their original default re-applied instead of disabled.
    const nativeColsWithDefault = nativeCols.filter((c) => defaultFilterGroupValuesRef.current[c]?.length);
    const nativeColsWithoutDefault = nativeCols.filter((c) => !defaultFilterGroupValuesRef.current[c]?.length);
    try {
      if (ownCols.length) {
        const ownGroupIds = [];
        ownCols.forEach((c) => {
          const ids = knownGroupIdsRef.current[c];
          if (ids) ownGroupIds.push(...ids);
        });
        if (ownGroupIds.length) await dashboard.removeFilterGroups(ownGroupIds);
        ownCols.forEach((c) => {
          delete known[c];
          delete knownGroupIdsRef.current[c];
        });
      }
      if (nativeColsWithoutDefault.length) {
        const groups = nativeColsWithoutDefault.flatMap((c) =>
          buildCategoryFilterGroupsForColumn(c, known[c] || [], 'DISABLED')
        );
        await dashboard.updateFilterGroups(groups);
        nativeColsWithoutDefault.forEach((c) => {
          known[c] = [];
        });
      }
      if (nativeColsWithDefault.length) {
        const groups = nativeColsWithDefault.flatMap((c) =>
          buildCategoryFilterGroupsForColumn(c, defaultFilterGroupValuesRef.current[c], 'ENABLED')
        );
        await dashboard.updateFilterGroups(groups);
        nativeColsWithDefault.forEach((c) => {
          known[c] = defaultFilterGroupValuesRef.current[c];
        });
      }
    } catch (e) {
      console.error('[filter-groups] clearAllKnownFilterGroups failed:', e.message);
    }
    ownCols.concat(nativeColsWithoutDefault).forEach((c) => clearColumn(c));
    nativeColsWithDefault.forEach((c) => setColumnFilter(c, defaultFilterGroupValuesRef.current[c], c));
  }, [embedRef, buildCategoryFilterGroupsForColumn, clearColumn, setColumnFilter]);

  const pollFilterGroupColumns = useCallback(async () => {
    const dashboard = embedRef.current;
    if (!dashboard || !sheetIdRef.current || !filterGroupColumns.size) return;
    try {
      const groups = await getFilterGroupsForSheetSafe(dashboard, sheetIdRef.current);
      const byCol = {};
      (groups || []).forEach((g) => {
        filterGroupColumns.forEach((col) => {
          const groupIds = groupTargetsForColumn(col).map((t) => t.groupId);
          if (!groupIds.includes(g.FilterGroupId)) return;
          const cf = g.Filters?.[0]?.CategoryFilter;
          const vals =
            g.Status !== 'DISABLED' && cf?.Configuration?.FilterListConfiguration
              ? cf.Configuration.FilterListConfiguration.CategoryValues || []
              : [];
          // Multiple datasets for the same column share one set of values --
          // once any of the column's FilterGroups reports non-empty values,
          // keep those instead of letting a later empty one overwrite them.
          if (vals.length || !byCol[col]) {
            byCol[col] = vals.map(String);
          }
        });
      });
      filterGroupColumns.forEach((col) => {
        const current = byCol[col] || [];
        const known = knownFilterGroupsRef.current[col] || [];
        const changed =
          current.length !== known.length ||
          [...current].sort().some((v, i) => v !== [...known].sort()[i]);
        if (!changed) return;
        console.log('[filter-groups] change detected for', col, ':', current);
        if (current.length) {
          knownFilterGroupsRef.current[col] = current;
        } else if (nativeFilterGroupIdRef.current[col]) {
          knownFilterGroupsRef.current[col] = [];
        } else {
          delete knownFilterGroupsRef.current[col];
        }
        setColumnFilter(col, current, col);
      });
    } catch (e) {
    }
  }, [embedRef, filterGroupColumns, groupTargetsForColumn, setColumnFilter]);

  useEffect(() => {
    if (!dashboardReady || !filterGroupColumns.size) return undefined;
    let cancelled = false;
    let pollIntervalId = null;

    (async () => {
      sheetIdRef.current = await resolveSheetId();
      if (!sheetIdRef.current) {
        console.error('[filter-groups] could not resolve a sheet id -- FilterGroups calls will fail');
      }
      await discoverNativeFilterGroups();
      await cleanupStaleFilterGroups();
      if (cancelled) return;
      readyRef.current = true;
      await flushPendingUpdates();
      pollIntervalId = setInterval(async () => {
        if (pollBusyRef.current) return;
        pollBusyRef.current = true;
        try {
          await flushPendingUpdates();
          await pollFilterGroupColumns();
        } finally {
          pollBusyRef.current = false;
        }
      }, POLL_INTERVAL_MS);
    })();

    return () => {
      cancelled = true;
      readyRef.current = false;
      if (pollIntervalId) clearInterval(pollIntervalId);
    };
  }, [dashboardReady, filterGroupColumns.size]);

  return { applyColumnFilter, clearAllKnownFilterGroups };
}
