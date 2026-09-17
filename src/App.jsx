import { Bookmark, FileDown, Redo2, RotateCcw, Search, Undo2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { FilterProvider } from './context/FilterContext';
import { useQuickSightBridge } from './hooks/useQuickSightBridge';
import { useFilterGroups } from './hooks/useFilterGroups';
import { useFilters } from './context/FilterContext';
import { useBookmarks } from './hooks/useBookmarks';
import { useToast } from './hooks/useToast';
import FilterBuilder from './components/FilterBuilder/FilterBuilder';
import DashboardEmbed from './components/DashboardEmbed';
import BookmarksPanel from './components/BookmarksPanel';
import ApiStatusBanner from './components/ApiStatusBanner';
import Toast from './components/Toast';
import './App.css';

const FILTER_HISTORY_LIMIT = 20;
// How long to keep ignoring appliedFilters changes after an undo/redo
// restore finishes, so the several setColumnFilter/setParameters calls it
// triggers settle before we resume treating changes as new user actions.
const FILTER_HISTORY_SETTLE_MS = 300;

function AppInner() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [bookmarksOpen, setBookmarksOpen] = useState(false);
  const [dashboardReady, setDashboardReady] = useState(false);
  const [dashboardResizing, setDashboardResizing] = useState(false);
  const resizeVeilTimerRef = useRef(null);
  const embedRef = useRef(null);
  const { toast, leaving: toastLeaving, showToast } = useToast();

  const toggleSidebar = () => {
    setSidebarCollapsed((c) => !c);
    setDashboardResizing(true);
    clearTimeout(resizeVeilTimerRef.current);
    resizeVeilTimerRef.current = setTimeout(() => setDashboardResizing(false), 450);
  };
  const {
    appliedFilters,
    paramForColumn,
    filterGroupColumns,
    columnToParams,
    canonicalColumn,
    defaultFilterValues,
    getDefaultFilterValue,
  } = useFilters();

  const { sendToQuickSight, resetAll, resetAndApply, handleParametersChanged } =
    useQuickSightBridge(embedRef);
  const { applyColumnFilter, clearAllKnownFilterGroups } = useFilterGroups(embedRef, dashboardReady);

  const appliedDefaultFiltersRef = useRef(false);
  useEffect(() => {
    if (!dashboardReady || appliedDefaultFiltersRef.current) return;
    appliedDefaultFiltersRef.current = true;
    Object.keys(defaultFilterValues).forEach((column) => {
      const values = getDefaultFilterValue(column);
      if (!values) return;
      if (filterGroupColumns.has(column)) {
        applyColumnFilter(column, values);
      } else {
        sendToQuickSight(paramForColumn(column), values);
      }
    });
  }, [dashboardReady]);

  const bmIdRef = useRef(new URLSearchParams(window.location.search).get('bm'));
  const bmAppliedRef = useRef(false);

  const handleBookmarkApplied = async (paramValues) => {
    const regular = {};
    const groups = {};
    Object.entries(paramValues || {}).forEach(([key, values]) => {
      if (filterGroupColumns.has(key)) {
        groups[key] = values;
      } else {
        regular[key] = values;
      }
    });
    resetAndApply(regular);
    await clearAllKnownFilterGroups();
    Object.entries(groups).forEach(([col, values]) => applyColumnFilter(col, values));
  };

  const { open: openBookmark } = useBookmarks({ onApplied: handleBookmarkApplied });

  // Our own undo/redo history over appliedFilters, since QuickSight's native
  // undo/redo can't be enabled without also showing its toolbar icon (see
  // DashboardEmbed.jsx). This only knows about filter/parameter changes --
  // it can't see or reverse in-sheet actions like sorts or drill-downs.
  const [filterPast, setFilterPast] = useState([]);
  const [filterFuture, setFilterFuture] = useState([]);
  const lastFiltersSnapshotRef = useRef(appliedFilters);
  const restoringFiltersRef = useRef(false);
  const filterHistoryMountedRef = useRef(false);

  useEffect(() => {
    if (!filterHistoryMountedRef.current) {
      filterHistoryMountedRef.current = true;
      lastFiltersSnapshotRef.current = appliedFilters;
      return;
    }
    if (restoringFiltersRef.current) {
      lastFiltersSnapshotRef.current = appliedFilters;
      return;
    }
    setFilterPast((prev) => [...prev.slice(-FILTER_HISTORY_LIMIT + 1), lastFiltersSnapshotRef.current]);
    setFilterFuture([]);
    lastFiltersSnapshotRef.current = appliedFilters;
  }, [appliedFilters]);

  const restoreFiltersSnapshot = async (snapshot) => {
    const regularParams = {};
    const groupUpdates = [];
    Object.entries(snapshot || {}).forEach(([col, f]) => {
      if (filterGroupColumns.has(col)) {
        groupUpdates.push([col, f.values]);
      } else {
        const paramName = f.paramName || paramForColumn(col);
        if (paramName) regularParams[paramName] = f.values;
      }
    });
    await resetAndApply(regularParams);
    await clearAllKnownFilterGroups();
    for (const [col, values] of groupUpdates) {
      await applyColumnFilter(col, values);
    }
  };

  const handleFilterApplied = (column, values) => {
    const isCleared = values.length === 1 && String(values[0]).toLowerCase() === 'all';
    const resolvedValues = isCleared ? getDefaultFilterValue(column) || [] : values;
    if (filterGroupColumns.has(column)) {
      applyColumnFilter(column, resolvedValues);
      if (isCleared && columnToParams[canonicalColumn(column)]) {
        sendToQuickSight(paramForColumn(column), resolvedValues);
      }
      return;
    }
    sendToQuickSight(paramForColumn(column), resolvedValues);
  };

  const handleResetAll = async () => {
    await resetAll();
    await clearAllKnownFilterGroups();
  };

  const handleClearRow = async (clearedCol) => {
    if (filterGroupColumns.has(clearedCol)) {
      applyColumnFilter(clearedCol, []);
      if (columnToParams[canonicalColumn(clearedCol)]) {
        sendToQuickSight(paramForColumn(clearedCol), getDefaultFilterValue(clearedCol) || []);
      }
      return;
    }
    const remaining = {};
    const groupUpdates = [];
    Object.entries(appliedFilters).forEach(([col, f]) => {
      if (col === clearedCol) return;
      if (filterGroupColumns.has(col)) {
        groupUpdates.push([col, f.values]);
        return;
      }
      remaining[f.paramName || paramForColumn(col)] = f.values;
    });
    await resetAndApply(remaining);
    for (const [col, values] of groupUpdates) {
      await applyColumnFilter(col, values);
    }
  };

  const handleParameterChange = (changedParameters, eventName) => {
    handleParametersChanged(changedParameters, eventName);
  };
  //blue ribbon bridge----Start
  useEffect(() => {
    function filterGroupsToParamsList(groups) {
      return (groups || [])
        .filter((g) => g.Status !== 'DISABLED')
        .map((g) => {
          const cf = g.Filters?.[0]?.CategoryFilter;
          const colName = cf?.Column?.ColumnName;
          const values = cf?.Configuration?.FilterListConfiguration?.CategoryValues || [];
          return colName ? { Name: colName, Value: values } : null;
        })
        .filter(Boolean);
    }

    function handleBlueRibbonRequest(event) {
      const msg = event.data;
      if (!msg || msg.type !== 'BLUE_RIBBON_REQUEST_PARAMS') return;
      (async () => {
        let reply;
        try {
          const dashboard = embedRef.current;
          if (!dashboard?.isReady()) {
            reply = { type: 'BLUE_RIBBON_PARAMS_RESULT', reqId: msg.reqId, params: [] };
          } else {
            const [params, sheetId] = await Promise.all([
              dashboard.getParameters(),
              dashboard.getSelectedSheetId(),
            ]);
            let filterGroupParams = [];
            if (sheetId) {
              try {
                const groups = await dashboard.getFilterGroupsForSheet(sheetId);
                filterGroupParams = filterGroupsToParamsList(groups);
              } catch (e) {
                console.warn('[blue-ribbon-bridge] getFilterGroupsForSheet failed:', e.message || e);
              }
            }
            reply = {
              type: 'BLUE_RIBBON_PARAMS_RESULT',
              reqId: msg.reqId,
              params: [...(params || []), ...filterGroupParams],
            };
          }
        } catch (e) {
          reply = { type: 'BLUE_RIBBON_PARAMS_RESULT', reqId: msg.reqId, error: e.message || String(e) };
        }
        event.source?.postMessage(reply, event.origin);
      })();
    }
    window.addEventListener('message', handleBlueRibbonRequest);
    return () => window.removeEventListener('message', handleBlueRibbonRequest);
  }, []);

  //blue ribbon bridge----End
  const handleUndo = async () => {
    if (!filterPast.length || restoringFiltersRef.current) return;
    const previous = filterPast[filterPast.length - 1];
    const current = lastFiltersSnapshotRef.current;
    setFilterPast((prev) => prev.slice(0, -1));
    setFilterFuture((prev) => [...prev, current]);
    restoringFiltersRef.current = true;
    try {
      await restoreFiltersSnapshot(previous);
    } catch (e) {
      console.error('[undo] failed:', e);
    } finally {
      setTimeout(() => {
        restoringFiltersRef.current = false;
        lastFiltersSnapshotRef.current = previous;
      }, FILTER_HISTORY_SETTLE_MS);
    }
  };

  const handleRedo = async () => {
    if (!filterFuture.length || restoringFiltersRef.current) return;
    const next = filterFuture[filterFuture.length - 1];
    const current = lastFiltersSnapshotRef.current;
    setFilterFuture((prev) => prev.slice(0, -1));
    setFilterPast((prev) => [...prev, current]);
    restoringFiltersRef.current = true;
    try {
      await restoreFiltersSnapshot(next);
    } catch (e) {
      console.error('[redo] failed:', e);
    } finally {
      setTimeout(() => {
        restoringFiltersRef.current = false;
        lastFiltersSnapshotRef.current = next;
      }, FILTER_HISTORY_SETTLE_MS);
    }
  };

  const handleExportPdf = async () => {
    if (!embedRef.current?.isReady()) {
      console.warn('[export] dashboard not ready, dropping export request');
      return;
    }
    try {
      await embedRef.current.initiatePrint();
    } catch (e) {
      console.error('[export] initiatePrint failed:', e);
    }
  };

  const handleDashboardLoaded = () => {
    setDashboardReady(true);
    const bmId = bmIdRef.current;
    if (!bmId || bmAppliedRef.current) return;
    bmAppliedRef.current = true;
    setTimeout(() => {
      openBookmark(bmId).catch((e) => console.error('[bookmark] failed to restore from URL:', e));
    }, 500);
  };

  return (
    <div className="app-root">
      <header className="header">
        <div>
          <h1>{import.meta.env.VITE_APP_TITLE || 'Safety View - COSMOS'}</h1>
        </div>
        <div className="header-actions">
          <button
            className={`btn-reset${sidebarCollapsed ? '' : ' active'}`}
            onClick={toggleSidebar}
            disabled={!dashboardReady}
            title={dashboardReady     ? 'Toggle Filter Builder' : 'Waiting for dashboard to load…'}
          >
            <Search size={14} strokeWidth={2.5} aria-hidden="true" />
            Search
          </button>
          <button
            className="btn-reset"
            onClick={handleUndo}
            disabled={!dashboardReady || !filterPast.length}
            title="Undo last filter change"
          >
            <Undo2 size={14} strokeWidth={2.5} aria-hidden="true" />
          </button>
          <button
            className="btn-reset"
            onClick={handleRedo}
            disabled={!dashboardReady || !filterFuture.length}
            title="Redo last filter change"
          >
            <Redo2 size={14} strokeWidth={2.5} aria-hidden="true" />
          </button>
          <button className="btn-reset" onClick={handleExportPdf} title="Export dashboard to PDF">
            <FileDown size={14} strokeWidth={2.5} aria-hidden="true" />
          </button>
          <button
            className="btn-reset"
            onClick={() => setBookmarksOpen(true)}
            title="View, open, save, rename, or delete saved bookmarks"
          >
            <Bookmark size={14} strokeWidth={2.5} aria-hidden="true" />
          </button>
          <button className="btn-reset" onClick={handleResetAll}>
            <RotateCcw size={14} strokeWidth={2.5} aria-hidden="true" />
          </button>
        </div>
      </header>

      <Toast toast={toast} leaving={toastLeaving} />

      <BookmarksPanel
        open={bookmarksOpen}
        onClose={() => setBookmarksOpen(false)}
        onApplied={handleBookmarkApplied}
        showToast={showToast}
      />

      <div className="main">
        <button
          className={`toggle-btn${sidebarCollapsed ? ' collapsed' : ''}`}
          onClick={toggleSidebar}
          disabled={!dashboardReady}
          title={dashboardReady ? 'Toggle Filter Builder' : 'Waiting for dashboard to load…'}
        >
          {sidebarCollapsed ? '▶' : '◀'}
        </button>

        <div className={`sidebar${sidebarCollapsed ? ' collapsed' : ''}`}>
          <FilterBuilder
            onFilterApplied={handleFilterApplied}
            onResetAll={handleResetAll}
            onClearRow={handleClearRow}
          />
        </div>

        <DashboardEmbed
          ref={embedRef}
          onParameterChange={handleParameterChange}
          onLoad={handleDashboardLoaded}
          onError={(e) => console.error('[dashboard] error', e)}
          resizing={dashboardResizing}
        />
      </div>
    </div>
  );
}

export default function App() {
  return (
    <FilterProvider>
      <AppInner />
    </FilterProvider>
  );
}
