import { useEffect, useMemo, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import type { MotionData, Series } from '../motion/types';
import { frameAt } from '../motion/math';
import { setFrame, useSession } from '../state/session';
function plotSeries(
  data: MotionData,
  selection: string,
  marker: number,
): { values: uPlot.AlignedData; unit: string; labels: string[] } {
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
export function SignalPlot({ data }: { data: MotionData }) {
  const target = useRef<HTMLDivElement>(null),
    selected = useSession((s) => s.selected),
    selection = useSession((s) => s.plot);
  const graph = useMemo(() => plotSeries(data, selection, selected), [data, selection, selected]);
  useEffect(() => {
    if (!target.current) return;
    const cursor = document.createElement('div');
    cursor.className = 'playhead';
    let chart: uPlot;
    const sync = () => {
      if (chart)
        cursor.style.left = `${chart.valToPos(useSession.getState().frame / data.timeline.rate, 'x')}px`;
    };
    const options: uPlot.Options = {
      width: target.current.clientWidth,
      height: 180,
      padding: [12, 14, 0, 0],
      scales: { x: { time: false, range: [0, Math.max(0.01, data.timeline.duration)] } },
      cursor: { drag: { x: false, y: false }, points: { show: false } },
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
    chart.over.appendChild(cursor);
    sync();
    const unsub = useSession.subscribe((s, p) => {
      if (s.frame !== p.frame) sync();
    });
    let dragging = false;
    const scrub = (event: PointerEvent) => {
      if (event.button !== 0 && event.type === 'pointerdown') return;
      const box = chart.over.getBoundingClientRect();
      const time = chart.posToVal(event.clientX - box.left, 'x');
      setFrame(frameAt(time, data.timeline.rate, data.timeline.frameCount));
    };
    const down = (e: PointerEvent) => {
      dragging = true;
      chart.over.setPointerCapture(e.pointerId);
      scrub(e);
    };
    const move = (e: PointerEvent) => {
      if (dragging) scrub(e);
    };
    const up = () => {
      dragging = false;
    };
    chart.over.addEventListener('pointerdown', down);
    chart.over.addEventListener('pointermove', move);
    chart.over.addEventListener('pointerup', up);
    chart.over.addEventListener('pointercancel', up);
    const observer = new ResizeObserver((entries) => {
      chart.setSize({
        width: Math.max(200, Math.floor(entries[0].contentRect.width)),
        height: 180,
      });
      sync();
    });
    observer.observe(target.current);
    return () => {
      observer.disconnect();
      unsub();
      chart.destroy();
    };
  }, [data, graph]);
  return (
    <section className="plot-panel">
      <div className="panel-heading">
        <span>SIGNAL INSPECTOR</span>
        <select
          aria-label="Signal to plot"
          value={selection}
          onChange={(e) => useSession.setState({ plot: e.target.value })}
        >
          <option value="marker">Marker · {data.markers.labels[selected]}</option>
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
        <span className="muted">Click or drag to scrub</span>
      </div>
      <div className="plot-target" ref={target} />
    </section>
  );
}
