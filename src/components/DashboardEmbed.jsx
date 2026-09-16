import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { createEmbeddingContext } from 'amazon-quicksight-embedding-sdk';

import { getEmbedUrl as fetchEmbedUrl } from '../api/filters';
import previewGif from '../assets/preview.gif';
async function getEmbedUrl(signal) {
  const data = await fetchEmbedUrl(signal);
  if (!data?.embedUrl) throw new Error('Backend did not return an embedUrl');
  return data.embedUrl;
}

const DashboardEmbed = forwardRef(function DashboardEmbed(
  { onParameterChange, onLoad, onError, resizing },
  ref
) {
  const containerRef = useRef(null);
  const dashboardRef = useRef(null);
  const defaultParamsRef = useRef(null);
  const [status, setStatus] = useState('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const onParameterChangeRef = useRef(onParameterChange);
  const onLoadRef = useRef(onLoad);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onParameterChangeRef.current = onParameterChange;
    onLoadRef.current = onLoad;
    onErrorRef.current = onError;
  });
  useImperativeHandle(ref, () => ({
    setParameters: (params) => dashboardRef.current?.setParameters(params),
    reset: () => dashboardRef.current?.reset(),
    isReady: () => Boolean(dashboardRef.current),
    initiatePrint: () => dashboardRef.current?.initiatePrint(),
    getParameters: () => dashboardRef.current?.getParameters(),
    getDefaultParameters: () => defaultParamsRef.current,
    getSelectedSheetId: () => dashboardRef.current?.getSelectedSheetId?.(),
    getSheets: () => dashboardRef.current?.getSheets?.(),
    getFilterGroupsForSheet: (sheetId) => dashboardRef.current?.getFilterGroupsForSheet?.(sheetId),
    addFilterGroups: (groups) => dashboardRef.current?.addFilterGroups?.(groups),
    updateFilterGroups: (groups) => dashboardRef.current?.updateFilterGroups?.(groups),
    removeFilterGroups: (ids) => dashboardRef.current?.removeFilterGroups?.(ids),
  }));

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [embedUrl, embeddingContext] = await Promise.all([
          getEmbedUrl(),
          createEmbeddingContext(),
        ]);
        if (cancelled) return;
        const seedInitialParameters = async () => {
          const delaysMs = [0, 1500, 3000, 5000];
          for (const delay of delaysMs) {
            if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
            if (cancelled) return;
            try {
              const params = await dashboardRef.current?.getParameters();
              if (cancelled) return;
              if (params?.length) {
                defaultParamsRef.current = params;
                onParameterChangeRef.current?.(params, 'PARAMETERS_CHANGED');
              }
            } catch (e) {
              console.error('[dashboard] getParameters failed:', e);
            }
          }
        };

        const frameOptions = {
          url: embedUrl,
          container: containerRef.current,
          height: '100%',
          width: '100%',
          onChange: (changeEvent) => {
            if (changeEvent.eventName === 'FRAME_LOADED') {
              setStatus('ready');
              onLoadRef.current?.();
              seedInitialParameters();
            }
          },
        };

        const contentOptions = {
          parameters: [],
          locale: 'en-US',
          sheetOptions: {
            fitSheetToWidth: true,
          },
          // The native undo/redo capability and its toolbar icon are tied
          // to this one flag with no way to separate them, so leave it off
          // -- undo/redo in the header is implemented as our own filter
          // history (see App.jsx) instead of QuickSight's own history.
          onMessage: async (messageEvent) => {
            if (messageEvent.eventName === 'PARAMETERS_CHANGED') {
              const changed = messageEvent.message?.changedParameters || [];
              console.debug('[dashboard] PARAMETERS_CHANGED', JSON.stringify(changed));
              if (changed.length) {
                onParameterChangeRef.current?.(changed, messageEvent.eventName);
              }
              return;
            }
            if (messageEvent.eventName === 'ERROR_OCCURRED') {
              setStatus('error');
              setErrorMsg(JSON.stringify(messageEvent.message));
              onErrorRef.current?.(messageEvent.message);
            }
          },
        };

        const dashboard = await embeddingContext.embedDashboard(frameOptions, contentOptions);
        dashboardRef.current = dashboard;
      } catch (e) {
        if (cancelled) return;
        console.error('[DashboardEmbed] failed to embed dashboard:', e);
        setStatus('error');
        setErrorMsg(
          e.type === 'ConfigError'
            ? 'QuickSight is not configured on the backend. Set AWS_ACCOUNT_ID, '
              + 'DASHBOARD_ID and QUICKSIGHT_USER_ARN, then restart the API.'
            : e.message || 'Failed to load dashboard'
        );
        onError?.(e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="dashboard-wrap">
      {status === 'loading' && (
        <div id="loading">
          <img src={previewGif} alt="" className="loading-gif" />
          <p>Loading dashboard...</p>
        </div>
      )}
      {status === 'error' && (
        <div className="error-box show">
          <div className="error-card">
            <h3>Failed to load dashboard</h3>
            <pre>{errorMsg}</pre>
          </div>
        </div>
      )}
      <div id="dashboard-container" ref={containerRef} />
      {resizing && <div className="dashboard-resize-veil" />}
    </div>
  );
});

export default DashboardEmbed;
