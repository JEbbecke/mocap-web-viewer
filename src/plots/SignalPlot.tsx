import { useEffect, useMemo, useRef, useState } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import type { MotionData, Series } from '../motion/types';
import { frameAt } from '../motion/math';
import { setFrame, useSession } from '../state/session';
import { PanelToggle } from '../components/PanelToggle';
function plotSeries(
  data: MotionData,
  selection: string,
  marker: number,
): { values: uPlot.AlignedData; unit: string; labels: string[] } {
  if (selection.startsWith('marker:')) {
    const index = Number(selection.split(':')[1]);
    if (Number.isInteger(index) && index >= 0 && index < data.markers.labels.length) marker = index;
    selection = 'marker';
  }
  if (selection === 'marker') {
    const n = data.timeline.frameCount,
      m = data.markers.labels.length;
    const times = Array.from({ length: n }, (_, i) => i / data.timeline.rate);
    const components = [0, 1, 2].map((a) =>
      Array.from({ length: n }, (_, i) =>
        data.markers.valid[i * m + marker]
          ? data.markers.positions[(i * m + marker) * 3 + a]
          : null,
      ),
    );
    return {
      values: [times, ...components] as uPlot.AlignedData,
      unit: 'm',
      labels: ['X', 'Y', 'Z'],
    };
  }
  const [kind, index, field] = selection.split(':');
  let signal: Series, unit: string;
  if (kind === 'analog') {
    const a = data.analogs[Number(index)];
    if (!a) return plotSeries(data, 'marker', marker);
    signal = a.signal;
    unit = a.unit;
  } else {
    const p = data.forcePlatforms[Number(index)];
    if (!p) return plotSeries(data, 'marker', marker);
    signal = field === 'moment' ? p.moment : field === 'cop' ? p.cop : p.force;
    unit = field === 'moment' ? 'Nm' : field === 'cop' ? 'm' : 'N';
  }
  const n = signal.values.length / signal.components;
  return {
    values: [
      Array.from({ length: n }, (_, i) => signal.startTime + i / signal.rate),
      ...Array.from({ length: signal.components }, (_, a) =>
        Array.from({ length: n }, (_, i) =>
          Number.isFinite(signal.values[i * signal.components + a])
            ? signal.values[i * signal.components + a]
            : null,
        ),
      ),
    ] as uPlot.AlignedData,
    unit,
    labels: signal.components === 1 ? ['Signal'] : ['X', 'Y', 'Z'],
  };
}
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
            <SignalPane
              data={data}
              selection={selection}
              onSelection={(plot) => useSession.setState({ plot })}
            />
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
  const [kind, index, field] = requestedSelection.split(':');
  const valid =
    requestedSelection === 'marker' ||
    (Number.isInteger(Number(index)) &&
      Number(index) >= 0 &&
      (kind === 'marker'
        ? Number(index) < data.markers.labels.length
        : kind === 'analog'
          ? Number(index) < data.analogs.length
          : kind === 'plate' &&
            Number(index) < data.forcePlatforms.length &&
            ['force', 'moment', 'cop'].includes(field)));
  const selection = valid ? requestedSelection : 'marker';
  const graph = useMemo(() => plotSeries(data, selection, selected), [data, selection, selected]);
  useEffect(() => {
    if (!target.current || !graph) return;
    const cursor = document.createElement('div');
    cursor.className = 'playhead';
    let chart: uPlot;
    const fullDuration = Math.max(0.01, data.timeline.duration);
    const sync = () => {
      if (chart) {
        const time = useSession.getState().frame / data.timeline.rate;
        cursor.style.left = `${chart.valToPos(time, 'x')}px`;
        cursor.hidden = time < chart.scales.x.min! || time > chart.scales.x.max!;
      }
    };
    const options: uPlot.Options = {
      width: target.current.clientWidth,
      height: 155,
      padding: [12, 14, 0, 0],
      scales: {
        x: {
          time: false,
          range: (_chart, min, max) =>
            min == null || max == null || min === max
              ? [0, fullDuration]
              : [Math.max(0, min), Math.min(fullDuration, max)],
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
    resetZoom.current = () => chart.setScale('x', { min: 0, max: fullDuration });
    chart.over.appendChild(cursor);
    sync();
    const unsub = useSession.subscribe((s, p) => {
      if (s.frame !== p.frame) sync();
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
      const minimumSpan = Math.min(fullDuration, 1 / data.timeline.rate);
      const span = Math.max(minimumSpan, Math.min(fullDuration, (max - min) * factor));
      const anchor = min + fraction * (max - min);
      const left = Math.max(0, Math.min(fullDuration - span, anchor - fraction * span));
      chart.setScale('x', { min: left, max: left + span });
    };
    chart.over.addEventListener('wheel', wheel, { passive: false });
    chart.over.addEventListener('pointerdown', down);
    chart.over.addEventListener('pointerup', up);
    chart.over.addEventListener('pointercancel', cancel);
    chart.over.addEventListener('pointerleave', cancel);
    const observer = new ResizeObserver((entries) => {
      chart.setSize({
        width: Math.max(200, Math.floor(entries[0].contentRect.width)),
        height: 155,
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
  }, [data, graph]);
  return (
    <div className="signal-pane" role="group" aria-label={secondary ? 'Second plot' : 'First plot'}>
      <div className="plot-pane-heading">
        <select
          aria-label={secondary ? 'Second signal to plot' : 'Signal to plot'}
          value={selection}
          onChange={(e) => onSelection(e.target.value)}
        >
          <option value="marker">Marker · {data.markers.labels[selected]}</option>
          <optgroup label="Markers">
            {data.markers.labels.map((label, i) => (
              <option key={i} value={`marker:${i}`}>
                {label}
              </option>
            ))}
          </optgroup>
          {data.forcePlatforms.map((p, i) => (
            <optgroup key={i} label={p.name}>
              {['force', 'moment', 'cop'].map((field) => (
                <option key={field} value={`plate:${i}:${field}`}>
                  {p.name} · {field === 'cop' ? 'COP' : field}
                </option>
              ))}
            </optgroup>
          ))}
          {data.analogs.length > 0 && (
            <optgroup label="Analog channels">
              {data.analogs.map((a, i) => (
                <option key={i} value={`analog:${i}`}>
                  {a.name} · {a.unit}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <button
          className="plot-reset"
          aria-label={secondary ? 'Reset second plot zoom' : 'Reset zoom'}
          onClick={() => resetZoom.current?.()}
        >
          Reset zoom
        </button>
      </div>
      <div className="plot-target" ref={target} />
    </div>
  );
}
