import { useEffect, useMemo, useRef, useState } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import type { MotionData, Series } from '../motion/types';
import { independentModelMessage } from '../motion/modelTiming';
import { frameAt } from '../motion/math';
import { setFrame, selectPlot, useSession } from '../state/session';
import { plotSeries } from './series';
import { modelPlotDescriptors } from './modelSeries';
import { cropPreviewInterval, outsideCropRegions } from './cropPreview';
import { SignalSelector } from './SignalSelector';
import { PanelToggle } from '../components/PanelToggle';
export function SignalPlot({
  data,
  collapsed,
  onToggle,
}: {
  data: MotionData;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const [split, setSplit] = useState(false);
  const [secondSelection, setSecondSelection] = useState('marker');
  const selection = useSession((s) => s.plot);
  return (
    <section id="signal-panel" className={`plot-panel ${collapsed ? 'is-collapsed' : ''}`}>
      <div className="panel-heading">
        <span>SIGNAL INSPECTOR</span>
        <span className="muted">
          Scroll or drag to zoom · Click to scrub · Double-click to reset
        </span>
        <div className="plot-view-controls">
          <button
            type="button"
            className="panel-toggle plot-split-toggle"
            aria-label="Split plots"
            aria-pressed={split}
            title={split ? 'Switch to single plot' : 'Split plots'}
            onClick={() => setSplit((value) => !value)}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <rect x="3" y="4" width="14" height="12" rx="1" />
              <path d="M10 4v12" />
            </svg>
          </button>
          <PanelToggle panel="plot" expanded={!collapsed} onToggle={onToggle} />
        </div>
      </div>
      <div id="signal-panel-content" hidden={collapsed}>
        {!collapsed && (
          <div className={`plot-panes ${split ? 'is-split' : ''}`}>
            <SignalPane data={data} selection={selection} onSelection={selectPlot} />
            {split && (
              <SignalPane
                data={data}
                selection={secondSelection}
                onSelection={setSecondSelection}
                secondary
              />
            )}
          </div>
        )}
      </div>
    </section>
  );
}
function SignalPane({
  data,
  selection: requestedSelection,
  onSelection,
  secondary = false,
}: {
  data: MotionData;
  selection: string;
  onSelection: (value: string) => void;
  secondary?: boolean;
}) {
  const target = useRef<HTMLDivElement>(null),
    resetZoom = useRef<(() => void) | null>(null),
    selected = useSession((s) => s.selected);
  const sourceFile = useSession((s) => s.sourceFile);
  const models = useMemo(() => modelPlotDescriptors(data), [data]);
  const model = models.find((d) => d.id === requestedSelection);
  const viewKey = `${model?.range?.start}:${model?.range?.end}:${model?.timeOrigin}`;
  const sourceGraph = useRef<{
    selection: string;
    file: File;
    viewKey: string;
    series: Series;
  } | null>(null);
  const [loadRevision, setLoadRevision] = useState(0);
  const [loadError, setLoadError] = useState('');
  useEffect(() => {
    sourceGraph.current = null;
    setLoadError('');
    if (!model) return;
    if (!sourceFile) {
      setLoadError('Original H5 file is unavailable.');
      return;
    }
    const worker = new Worker(new URL('../workers/explorer.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (event) => {
      if (event.data.error) setLoadError(event.data.error);
      else {
        sourceGraph.current = {
          selection: requestedSelection,
          file: sourceFile,
          viewKey,
          series: event.data.series,
        };
        setLoadRevision((v) => v + 1);
      }
      worker.terminate();
    };
    worker.onerror = () => {
      setLoadError('Model plot reader failed.');
      worker.terminate();
    };
    worker.postMessage({
      file: sourceFile,
      request: {
        kind: model.kind,
        sourceIndex: model.sourceIndex,
        offset: 0,
        range: model.range,
        timeOrigin: model.timeOrigin,
      },
      plot: true,
    });
    return () => {
      worker.terminate();
      sourceGraph.current = null;
    };
  }, [model?.id, model?.sourceIndex, sourceFile, viewKey]);
  const [kind, index, field] = requestedSelection.split(':');
  const valid =
    !!model ||
    requestedSelection === 'none' ||
    requestedSelection === 'marker' ||
    (Number.isInteger(Number(index)) &&
      Number(index) >= 0 &&
      (kind === 'marker'
        ? Number(index) < data.markers.labels.length
        : kind === 'analog'
          ? Number(index) < data.analogs.length
          : kind === 'signal'
            ? Number(index) < (data.signals?.length ?? 0)
            : kind === 'plate' &&
              Number(index) < data.forcePlatforms.length &&
              (['force', 'moment', 'cop'].includes(field) ||
                (field === 'freeMoment' && !!data.forcePlatforms[Number(index)].freeMoment))));
  const selection = valid ? requestedSelection : 'marker';
  const graph = useMemo(() => {
    if (selection === 'none') return null;
    if (!model) return plotSeries(data, selection, selected);
    const loaded = sourceGraph.current;
    if (
      !loaded ||
      loaded.selection !== selection ||
      loaded.file !== sourceFile ||
      loaded.viewKey !== viewKey
    )
      return null;
    return {
      values: [loaded.series.times!, loaded.series.values] as uPlot.AlignedData,
      unit: model.unit,
      labels: [model.label],
    };
  }, [data, selection, selected, model, sourceFile, loadRevision, viewKey]);
  const croppedWithTrial = model ? model.aligned : true;
  useEffect(() => {
    if (!target.current || !graph) return;
    const cursor = document.createElement('div');
    cursor.className = 'playhead';
    const muted = (['before', 'after'] as const).map((side) => {
      const region = document.createElement('div');
      region.className = `plot-crop-muted plot-crop-${side}`;
      region.setAttribute('aria-hidden', 'true');
      region.hidden = true;
      return region;
    });
    let chart: uPlot;
    const fullStart = Math.min(0, graph.values[0][0] ?? 0);
    const fullDuration = Math.max(0.01, data.timeline.duration, graph.values[0].at(-1) ?? 0);
    const sync = () => {
      if (chart) {
        const time = useSession.getState().frame / data.timeline.rate;
        cursor.style.left = `${chart.valToPos(time, 'x')}px`;
        cursor.hidden = time < chart.scales.x.min! || time > chart.scales.x.max!;
        const interval = cropPreviewInterval(
          data,
          useSession.getState().cropSelection,
          croppedWithTrial,
        );
        const regions = outsideCropRegions(interval, {
          start: chart.scales.x.min!,
          end: chart.scales.x.max!,
        });
        [regions.before, regions.after].forEach((range, index) => {
          const element = muted[index];
          element.hidden = !range;
          if (range) {
            const left = chart.valToPos(range.start, 'x'),
              right = chart.valToPos(range.end, 'x');
            element.style.left = `${left}px`;
            element.style.width = `${Math.max(0, right - left)}px`;
            element.dataset.start = String(range.start);
            element.dataset.end = String(range.end);
          }
        });
      }
    };
    const options: uPlot.Options = {
      width: Math.max(200, target.current.clientWidth - 20),
      height: Math.max(80, target.current.clientHeight - 24),
      padding: [12, 14, 0, 0],
      scales: {
        x: {
          time: false,
          range: (_chart, min, max) =>
            min == null || max == null || min === max
              ? [fullStart, fullDuration]
              : [Math.max(fullStart, min), Math.min(fullDuration, max)],
        },
      },
      cursor: { drag: { x: true, y: false, dist: 5 }, points: { show: false } },
      select: { show: true, over: true, left: 0, top: 0, width: 0, height: 0 },
      legend: { show: true },
      series: [
        { label: 'Time (s)' },
        ...graph.labels.map((label, i) => ({
          label: `${label} (${graph.unit})`,
          stroke: ['#70bcff', '#78e0c1', '#ffbd70'][i],
          width: 1.4,
          spanGaps: false,
        })),
      ],
      axes: [
        {
          stroke: '#94a6b8',
          grid: { stroke: '#253441' },
          ticks: { stroke: '#253441' },
          font: '11px system-ui',
          size: 30,
        },
        {
          stroke: '#94a6b8',
          grid: { stroke: '#253441' },
          ticks: { stroke: '#253441' },
          font: '11px system-ui',
          size: 64,
        },
      ],
      hooks: { draw: [sync] },
    };
    chart = new uPlot(options, graph.values, target.current);
    resetZoom.current = () => chart.setScale('x', { min: fullStart, max: fullDuration });
    chart.over.prepend(...muted);
    chart.over.appendChild(cursor);
    sync();
    const unsub = useSession.subscribe((s, p) => {
      if (s.frame !== p.frame || s.cropSelection !== p.cropSelection) sync();
    });
    let pointerStart: { x: number; y: number } | null = null;
    const scrub = (event: PointerEvent) => {
      if (event.button !== 0 && event.type === 'pointerdown') return;
      const box = chart.over.getBoundingClientRect();
      const time = chart.posToVal(event.clientX - box.left, 'x');
      useSession.setState({ playing: false });
      setFrame(frameAt(time, data.timeline.rate, data.timeline.frameCount));
    };
    const down = (e: PointerEvent) => {
      if (e.button === 0) pointerStart = { x: e.clientX, y: e.clientY };
    };
    const up = (e: PointerEvent) => {
      if (pointerStart && Math.hypot(e.clientX - pointerStart.x, e.clientY - pointerStart.y) < 5)
        scrub(e);
      pointerStart = null;
    };
    const cancel = () => {
      pointerStart = null;
    };
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey || event.deltaY === 0) return;
      event.preventDefault();
      if (pointerStart) return;
      const box = chart.over.getBoundingClientRect();
      if (!box.width) return;
      const fraction = Math.max(0, Math.min(1, (event.clientX - box.left) / box.width));
      const min = chart.scales.x.min!,
        max = chart.scales.x.max!;
      const delta =
        event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? box.height : 1);
      const factor = Math.exp(Math.max(-2, Math.min(2, delta * 0.002)));
      const minimumSpan = Math.min(fullDuration - fullStart, 1 / data.timeline.rate);
      const span = Math.max(minimumSpan, Math.min(fullDuration - fullStart, (max - min) * factor));
      const anchor = min + fraction * (max - min);
      const left = Math.max(fullStart, Math.min(fullDuration - span, anchor - fraction * span));
      chart.setScale('x', { min: left, max: left + span });
    };
    chart.over.addEventListener('wheel', wheel, { passive: false });
    chart.over.addEventListener('pointerdown', down);
    chart.over.addEventListener('pointerup', up);
    chart.over.addEventListener('pointercancel', cancel);
    chart.over.addEventListener('pointerleave', cancel);
    const observer = new ResizeObserver((entries) => {
      const legendHeight =
        chart.root.querySelector('.u-legend')?.getBoundingClientRect().height ?? 24;
      chart.setSize({
        width: Math.max(200, Math.floor(entries[0].contentRect.width)),
        height: Math.max(80, Math.floor(entries[0].contentRect.height - legendHeight)),
      });
      sync();
    });
    observer.observe(target.current);
    return () => {
      observer.disconnect();
      unsub();
      chart.over.removeEventListener('wheel', wheel);
      resetZoom.current = null;
      chart.destroy();
    };
  }, [data, graph, croppedWithTrial]);
  return (
    <div className="signal-pane" role="group" aria-label={secondary ? 'Second plot' : 'First plot'}>
      <div className="plot-pane-heading">
        <SignalSelector
          label={secondary ? 'Second signal to plot' : 'Signal to plot'}
          value={selection}
          onChange={onSelection}
        >
          <option value="none">No signal</option>
          <option value="marker">Marker · {data.markers.labels[selected]}</option>
          <optgroup label="Markers">
            {data.markers.labels.map((label, i) => (
              <option key={i} value={`marker:${i}`}>
                {label}
              </option>
            ))}
          </optgroup>
          {(data.analogs.length > 0 || data.signals?.some((s) => s.group === 'EMG')) && (
            <optgroup label="Analogs">
              {data.analogs.map((a, i) => (
                <option key={`analog:${i}`} value={`analog:${i}`}>
                  {a.name} ⋅ {a.unit}
                </option>
              ))}
              {data.signals?.map(
                (s, i) =>
                  s.group === 'EMG' && (
                    <option key={`signal:${i}`} value={`signal:${i}`}>
                      EMG ⋅ {s.name} ⋅ {s.unit}
                    </option>
                  ),
              )}
            </optgroup>
          )}
          {data.forcePlatforms.length > 0 && (
            <optgroup label="Forces">
              {data.forcePlatforms.flatMap((p, i) =>
                ['force', 'moment', 'cop', ...(p.freeMoment ? ['freeMoment'] : [])].map((field) => (
                  <option key={`plate:${i}:${field}`} value={`plate:${i}:${field}`}>
                    {p.name} ⋅ {field === 'cop' ? 'COP' : field}
                  </option>
                )),
              )}
            </optgroup>
          )}
          {data.signals?.some((s) => s.group === 'RigidBodies') && (
            <optgroup label="Rigid Bodies">
              {data.signals.map(
                (s, i) =>
                  s.group === 'RigidBodies' && (
                    <option key={i} value={`signal:${i}`}>
                      {s.name} ⋅ {s.unit}
                    </option>
                  ),
              )}
            </optgroup>
          )}
          {(['ik', 'id'] as const).map((kind) => {
            const descriptors = models.filter((d) => d.kind === kind);
            const group = kind === 'ik' ? 'IKResults' : 'IDResults';
            const unit = kind === 'ik' ? 'deg' : 'Nm';
            const signals = (data.signals ?? []).flatMap((s, i) =>
              s.group === group ? [{ ...s, index: i }] : [],
            );
            return (
              (descriptors.length > 0 || signals.length > 0) && (
                <optgroup key={kind} label={`${kind.toUpperCase()} Results`}>
                  {descriptors.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.label} ⋅ {unit}
                    </option>
                  ))}
                  {signals.map((s) => (
                    <option key={`signal:${s.index}`} value={`signal:${s.index}`}>
                      {kind.toUpperCase()} ⋅ {s.name} ⋅ {unit}
                    </option>
                  ))}
                </optgroup>
              )
            );
          })}
        </SignalSelector>
        <button
          className="plot-reset"
          aria-label={secondary ? 'Reset second plot zoom' : 'Reset zoom'}
          onClick={() => resetZoom.current?.()}
        >
          Reset zoom
        </button>
      </div>
      <p
        className="muted small signal-model-note"
        role={loadError ? 'alert' : undefined}
        title={loadError || (model && !model.aligned ? independentModelMessage : undefined)}
      >
        {loadError || (model && !model.aligned ? independentModelMessage : '')}
        {model && !graph && !loadError && (
          <span role="status">{model.aligned ? 'Loading model signal?' : ' ? Loading?'}</span>
        )}
      </p>
      <div className="plot-target" ref={target} />
    </div>
  );
}
