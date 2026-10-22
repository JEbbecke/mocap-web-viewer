import { Component, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ResizeHandle } from './layout/ResizeHandle';
import { clampPanel, panelBounds } from './layout/geometry';
import { useElementSize, useMediaQuery } from './layout/useElementSize';
import { Viewer3D } from './viewer/Viewer3D';
import { Inspector } from './components/Inspector';
import { Timeline } from './components/Timeline';
import { SignalPlot } from './plots/SignalPlot';
import { startClock } from './playback/clock';
import {
  cancelImport,
  openFile,
  openExampleFile,
  setFrame,
  togglePlay,
  undoEdit,
  redoEdit,
  useSession,
} from './state/session';
import { handleHistoryShortcut } from './state/shortcuts';
import { PanelToggle } from './components/PanelToggle';
import { DataExplorer } from './components/DataExplorer';
import { ExportControl } from './components/ExportControl';
import { trackEvent } from './analytics';
import { LicenseInfo } from './components/LicenseInfo';
class ViewerBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  render() {
    return this.state.error ? (
      <div className="error-banner" role="alert">
        3D rendering failed: {this.state.error}. Try reloading with hardware acceleration enabled.
      </div>
    ) : (
      this.props.children
    );
  }
}
export function App() {
  const data = useSession((s) => s.data),
    history = useSession((s) => s.history),
    dirty = useSession((s) => s.dirty),
    busy = useSession((s) => s.busy),
    cropSelection = useSession((s) => s.cropSelection),
    sourceFile = useSession((s) => s.sourceFile),
    operation = useSession((s) => s.operation),
    error = useSession((s) => s.error),
    input = useRef<HTMLInputElement>(null),
    [showPlot, setShowPlot] = useState(true),
    [showSidebar, setShowSidebar] = useState(true),
    [showExplorer, setShowExplorer] = useState(false),
    [dragging, setDragging] = useState(false);
  const visitTracked = useRef(false);
  const workspace = useRef<HTMLDivElement>(null);
  const column = useRef<HTMLDivElement>(null);
  const timeline = useRef<HTMLDivElement>(null);
  const workspaceSize = useElementSize(workspace);
  const columnSize = useElementSize(column);
  const timelineSize = useElementSize(timeline, !!data);
  const desktop = useMediaQuery('(min-width: 761px)');
  const wide = useMediaQuery('(min-width: 1101px)');
  const [inspectorWidth, setInspectorWidth] = useState<number | null>(null);
  const [explorerWidth, setExplorerWidth] = useState<number | null>(null);
  const [plotHeights, setPlotHeights] = useState<{
    visualizer: number | null;
    explorer: number | null;
  }>({ visualizer: null, explorer: null });
  const activeWorkspace = data && showExplorer ? 'explorer' : 'visualizer';
  // Reserve the stable Timeline controls. Event Editor borrows Viewer/table space;
  // very short windows scroll rather than shrinking the preferred plot for editing.
  const plotBounds = panelBounds(
    180,
    Math.max(
      180,
      Math.min(720, columnSize.height - timelineSize.height - (showExplorer ? 300 : 210) - 6),
    ),
  );
  const plotHeight = clampPanel(
    plotHeights[activeWorkspace] ?? (showExplorer ? columnSize.height * 0.28 : 254),
    plotBounds.min,
    plotBounds.max,
  );
  const changePlotHeight = (value: number | null) =>
    setPlotHeights((previous) => ({ ...previous, [activeWorkspace]: value }));
  const inspectorBounds = panelBounds(260, Math.min(560, workspaceSize.width - 400));
  const effectiveInspectorWidth = clampPanel(
    inspectorWidth ?? (wide ? 310 : 270),
    inspectorBounds.min,
    inspectorBounds.max,
  );

  useEffect(startClock, []);
  useEffect(() => {
    // Keep StrictMode's effect replay within the same mounted instance to one visit.
    if (visitTracked.current) return;
    visitTracked.current = true;
    void trackEvent('visit');
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (handleHistoryShortcut(e)) return;
      if (e.defaultPrevented || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (
        (e.target as HTMLElement).closest('input,select,textarea,button,[contenteditable="true"]')
      )
        return;
      const s = useSession.getState();
      if (!s.data || s.busy) return;
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        useSession.setState({ playing: false });
        setFrame(s.frame + (e.key === 'ArrowRight' ? 1 : -1));
      } else if (e.key === 'Home') {
        e.preventDefault();
        setFrame(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        setFrame(s.data.timeline.frameCount - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const open = () => input.current?.click();
  return (
    <main
      className={`app ${dragging ? 'dragging' : ''}`}
      onClick={(event) => {
        // Mouse/touch actions should not trap subsequent playback shortcuts on a control.
        // Keyboard-activated controls keep their focus and normal Space/Enter behavior.
        if (event.detail === 0) return;
        const control = (event.target as HTMLElement).closest<HTMLElement>(
          'button,input[type="checkbox"],input[type="radio"]',
        );
        if (control === document.activeElement) control?.blur();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files[0];
        if (file) openFile(file);
      }}
    >
      <header>
        <div className="brand-mark">
          <svg viewBox="0 0 32 32" aria-hidden="true">
            <path d="M7 25 15 7l10 18M11 17h10" fill="none" stroke="currentColor" strokeWidth="2" />
            <circle cx="15" cy="7" r="3" />
            <circle cx="7" cy="25" r="3" />
            <circle cx="25" cy="25" r="3" />
          </svg>
        </div>
        <div className="brand">
          <strong>
            JE <span>Motion Lab</span>
          </strong>
          <span>MoCap Viewer &amp; Editor</span>
        </div>
        <div className="workspace-nav" role="group" aria-label="Workspace">
          <button
            aria-label="Data Visualizer"
            title="Data Visualizer"
            aria-pressed={!data || !showExplorer}
            disabled={!data}
            onClick={() => setShowExplorer(false)}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="m10 2 7 4v8l-7 4-7-4V6Zm0 8 7-4M10 10 3 6m7 4v8" />
            </svg>
            <span className="workspace-label">Data Visualizer</span>
          </button>
          <button
            aria-label="Data Explorer"
            title="Data Explorer"
            aria-pressed={!!data && showExplorer}
            disabled={!data}
            onClick={() => setShowExplorer(true)}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <rect x="2.5" y="3" width="15" height="14" rx="1.5" />
              <path d="M3 8h14M3 12.5h14M8 8v9" />
            </svg>
            <span className="workspace-label">Data Explorer</span>
          </button>
        </div>
        <div className="header-file">
          {data ? (
            <>
              <span className="file-badge">{data.source.format}</span>
              <span>
                {data.name}
                {data.source.crop ? ' · Cropped' : ''}
                {dirty ? ' · Modified' : ''}
              </span>
            </>
          ) : (
            <span className="muted">No trial loaded</span>
          )}
        </div>
        {data && (
          <div className="history-controls">
            <button
              aria-label="Undo"
              onClick={undoEdit}
              disabled={busy || !history.past.length}
              title={`Undo${history.past.length ? ': ' + history.past.at(-1)!.command.description : ''} (Ctrl/Cmd+Z)`}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M7 3 3 7l4 4M3 7h9a5 5 0 0 1 0 10H9" />
              </svg>
              <span className="header-action-label">Undo</span>
            </button>
            <button
              aria-label="Redo"
              onClick={redoEdit}
              disabled={busy || !history.future.length}
              title={`Redo${history.future.length ? ': ' + history.future.at(-1)!.command.description : ''} (Ctrl/Cmd+Shift+Z, Ctrl+Y)`}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="m13 3 4 4-4 4m4-4H8a5 5 0 0 0 0 10h3" />
              </svg>
              <span className="header-action-label">Redo</span>
            </button>
          </div>
        )}
        <div className="file-actions">
          {data && (
            <ExportControl data={data} disabled={busy || !sourceFile || Boolean(cropSelection)} />
          )}
          <button className="primary" onClick={open} aria-label="Open file" title="Open file">
            <span aria-hidden="true">＋</span>{' '}
            <span className="header-action-label">Open file</span>
          </button>
        </div>
        <input
          ref={input}
          className="sr-only"
          type="file"
          accept=".c3d,.h5,.hdf5"
          aria-label="Open motion file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) openFile(file);
            e.target.value = '';
          }}
        />
      </header>
      {error && (
        <div className="error-banner" role="alert">
          <strong>Operation could not be completed.</strong> {error}
          <button onClick={() => useSession.setState({ error: null })} aria-label="Dismiss error">
            ×
          </button>
        </div>
      )}
      {data?.warnings.length ? (
        <details className="warnings">
          <summary>
            {data.warnings.length} import {data.warnings.length === 1 ? 'note' : 'notes'}{' '}
            <span>
              {data.source.partialImport
                ? 'File loaded with limitations: rotation data was not imported'
                : 'Review data conventions'}
            </span>
          </summary>
          <ul>
            {data.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      ) : null}
      <div
        ref={workspace}
        className={`workspace ${data && showExplorer ? 'is-exploring' : ''}`}
        style={{ '--trial-inspector-width': `${effectiveInspectorWidth}px` } as CSSProperties}
      >
        <div className="main-column" ref={column}>
          {data && showExplorer && (
            <DataExplorer
              data={data}
              onClose={() => setShowExplorer(false)}
              preferredWidth={explorerWidth}
              onWidthChange={setExplorerWidth}
            />
          )}
          <div className="viewer-workspace" hidden={!!data && showExplorer}>
            <div className="scene-wrap">
              <ViewerBoundary>
                <Viewer3D data={data} active={!data || !showExplorer} />
              </ViewerBoundary>
              {!data && (
                <div className="welcome">
                  <div className="eyebrow">YOUR DATA. YOUR WORKSPACE.</div>
                  <h1>
                    Explore motion,
                    <br />
                    frame by frame.
                  </h1>
                  <p>
                    Open a C3D or H5 recording to inspect and edit
                    <br />
                    trajectories, forces, analogs and events.
                  </p>
                  <div className="welcome-actions">
                    <button className="primary" onClick={open}>
                      Open a recording
                    </button>
                    <button onClick={() => void openExampleFile()} disabled={busy} aria-busy={busy}>
                      {busy ? 'Loading example…' : 'Load Example File'}
                    </button>
                  </div>
                  <span className="muted">or drop a file anywhere</span>
                  <div className="format-tags">
                    <span>C3D</span>
                    <span>H5 / HDF5</span>
                    <span>LOCAL ONLY</span>
                  </div>
                </div>
              )}
            </div>
          </div>
          {data && (
            <>
              <Timeline data={data} controlsRef={timeline} />
              {desktop && showPlot && (
                <ResizeHandle
                  key={activeWorkspace}
                  axis="vertical"
                  label="Signal Inspector height"
                  controls="signal-panel"
                  value={plotHeight}
                  {...plotBounds}
                  sign={-1}
                  onChange={changePlotHeight}
                  onReset={() => changePlotHeight(null)}
                />
              )}
              <SignalPlot
                data={data}
                collapsed={!showPlot}
                explorer={showExplorer}
                height={desktop ? plotHeight : undefined}
                onToggle={() => setShowPlot((value) => !value)}
              />
            </>
          )}
        </div>
        {desktop && showSidebar && !(data && showExplorer) && (
          <ResizeHandle
            axis="horizontal"
            label="Trial Inspector width"
            controls="trial-inspector"
            value={effectiveInspectorWidth}
            {...inspectorBounds}
            sign={-1}
            onChange={setInspectorWidth}
            onReset={() => setInspectorWidth(null)}
          />
        )}
        {data ? (
          <Inspector
            data={data}
            collapsed={!showSidebar}
            onToggle={() => setShowSidebar((value) => !value)}
          />
        ) : (
          <aside
            id="trial-inspector"
            className={`empty-inspector ${showSidebar ? '' : 'is-collapsed'}`}
          >
            <div className="sidebar-heading">
              <span className="sidebar-title">TRIAL INSPECTOR</span>
              <PanelToggle
                panel="sidebar"
                expanded={showSidebar}
                onToggle={() => setShowSidebar((value) => !value)}
              />
            </div>
            <div className="empty-inspector-content">
              <span className="empty-icon">⌁</span>
              <h3>A closer look at your trial</h3>
              <p>Marker coordinates, display controls and recording details appear here.</p>
              <div className="feature-line">
                <span>01</span> Navigate in 3D
              </div>
              <div className="feature-line">
                <span>02</span> Inspect frame by frame
              </div>
              <div className="feature-line">
                <span>03</span> Basic file editing
              </div>
            </div>
          </aside>
        )}
      </div>
      <footer>
        <span>
          <span className="privacy-dot" /> Files are processed locally in your browser and are never
          uploaded.
        </span>
        <span>
          <span className="footer-gh-repo">© 2026 JE Motion Lab</span>
          <span className="footer-version" aria-label={`JE Motion Lab version ${__APP_VERSION__}`}>
            v{__APP_VERSION__}
          </span>
          <span className="footer-gh-repo">
            <a
              href="https://github.com/JEbbecke/mocap-web-viewer"
              target="_blank"
              rel="noopener noreferrer"
            >
              Source on GitHub
            </a>
          </span>
          <span className="footer-gh-repo">
            <LicenseInfo />
          </span>
          <span className="footer-gh-repo">
            <a href="https://jemolab.com/privacy.html" target="_blank" rel="noopener noreferrer">
              Privacy
            </a>
          </span>
          <span className="footer-gh-repo">
            <a href="https://jemolab.com/imprint.html" target="_blank" rel="noopener noreferrer">
              Imprint
            </a>
          </span>
        </span>
      </footer>
      {dragging && <div className="drop-overlay">Drop your motion file to open it locally</div>}
      {busy && (
        <div className="loading-overlay" role="status">
          <div className="loading-card">
            <span className="spinner" />
            <h2>
              {operation === 'export'
                ? 'Preparing your export'
                : operation === 'download'
                  ? 'Loading example file'
                  : 'Reading your recording'}
            </h2>
            <p>Processing locally. Your file stays on this device.</p>
            <button onClick={cancelImport}>Cancel</button>
          </div>
        </div>
      )}
    </main>
  );
}
