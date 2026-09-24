import { Component, useEffect, useRef, useState, type ReactNode } from 'react';
import { Viewer3D } from './viewer/Viewer3D';
import { Inspector } from './components/Inspector';
import { Timeline } from './components/Timeline';
import { SignalPlot } from './plots/SignalPlot';
import { startClock } from './playback/clock';
import { cancelImport, openFile, setData, setFrame, togglePlay, useSession } from './state/session';
import { makeDemo } from './motion/demo';
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
    busy = useSession((s) => s.busy),
    error = useSession((s) => s.error),
    input = useRef<HTMLInputElement>(null),
    [dragging, setDragging] = useState(false);
  useEffect(startClock, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement).closest('input,select,textarea,button,[contenteditable="true"]')
      )
        return;
      const s = useSession.getState();
      if (!s.data) return;
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
            IBO <span>Motion workspace</span>
          </strong>
          <span>LOCAL MOCAP VIEWER</span>
        </div>
        <div className="header-file">
          {data ? (
            <>
              <span className="file-badge">{data.source.format}</span>
              <span>{data.name}</span>
            </>
          ) : (
            <span className="muted">No trial loaded</span>
          )}
        </div>
        <button className="primary" onClick={open}>
          ＋ Open file
        </button>
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
          <strong>Could not open file.</strong> {error}
          <button onClick={() => useSession.setState({ error: null })} aria-label="Dismiss error">
            ×
          </button>
        </div>
      )}
      {data?.warnings.length ? (
        <details className="warnings">
          <summary>
            {data.warnings.length} import {data.warnings.length === 1 ? 'note' : 'notes'}{' '}
            <span>Review data conventions</span>
          </summary>
          <ul>
            {data.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      ) : null}
      <div className="workspace">
        <div className="main-column">
          <div className="scene-wrap">
            <ViewerBoundary>
              <Viewer3D data={data} />
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
                  Open a C3D or institute H5 recording to inspect
                  <br />
                  trajectories, forces and synchronized signals.
                </p>
                <button className="primary" onClick={open}>
                  Open a recording
                </button>
                <span className="muted">or drop a file anywhere</span>
                <button
                  className="text-button demo-button"
                  onClick={() => {
                    cancelImport();
                    setData(makeDemo());
                  }}
                >
                  Explore the synthetic demo →
                </button>
                <div className="format-tags">
                  <span>C3D</span>
                  <span>H5 / HDF5</span>
                  <span>LOCAL ONLY</span>
                </div>
              </div>
            )}
          </div>
          {data && (
            <>
              <Timeline data={data} />
              <SignalPlot data={data} />
            </>
          )}
        </div>
        {data ? (
          <Inspector data={data} />
        ) : (
          <aside className="empty-inspector">
            <div className="sidebar-heading">TRIAL INSPECTOR</div>
            <div className="empty-inspector-content">
              <span className="empty-icon">⌁</span>
              <h3>A closer look at your trial</h3>
              <p>Marker coordinates, display controls and recording details appear here.</p>
              <div className="feature-line">
                <span>01</span> Navigate in 3D
              </div>
              <div className="feature-line">
                <span>02</span> Inspect every frame
              </div>
              <div className="feature-line">
                <span>03</span> Compare synchronized signals
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
          {data
            ? `${data.timeline.rate} Hz · ${data.markers.labels.length} markers · ${data.forcePlatforms.length} plates`
            : 'C3D + institute H5'}
          <span className="footer-version">v0.1</span>
        </span>
      </footer>
      {dragging && <div className="drop-overlay">Drop your motion file to open it locally</div>}
      {busy && (
        <div className="loading-overlay" role="status">
          <div className="loading-card">
            <span className="spinner" />
            <h2>Reading your recording</h2>
            <p>Parsing locally. Your file stays on this device.</p>
            <button onClick={cancelImport}>Cancel</button>
          </div>
        </div>
      )}
    </main>
  );
}
