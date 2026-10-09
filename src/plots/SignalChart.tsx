import { useEffect, useRef, type ReactNode } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import type { MotionData } from '../motion/types';
import { frameAt } from '../motion/math';
import { setFrame, useSession } from '../state/session';
import { cropPreviewInterval, outsideCropRegions } from './cropPreview';
import type { PlotData } from './series';

/** One chart implementation for Viewer selectors and Explorer column descriptors. */
export function SignalChart({
  data,
  graph,
  croppedWithTrial = true,
  toolbar,
  status = '',
  secondary = false,
  statusRole = 'status',
  emptyMessage = 'Select a signal to plot.',
}: {
  data: MotionData;
  graph: PlotData | null;
  croppedWithTrial?: boolean;
  toolbar?: ReactNode;
  status?: string;
  secondary?: boolean;
  statusRole?: 'status' | 'alert';
  emptyMessage?: string;
}) {
  const target = useRef<HTMLDivElement>(null),
    resetZoom = useRef<(() => void) | null>(null);
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
      height: Math.max(50, target.current.clientHeight - 24),
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
          stroke: ['#70bcff', '#78e0c1', '#ffbd70'][i % 3],
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
        height: Math.max(50, Math.floor(entries[0].contentRect.height - legendHeight)),
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
        {toolbar ?? <span className="muted small">Selected columns</span>}
        <button
          className="plot-reset"
          aria-label={secondary ? 'Reset second plot zoom' : 'Reset zoom'}
          onClick={() => resetZoom.current?.()}
        >
          Reset zoom
        </button>
      </div>
      <p className="muted small signal-model-note" title={status} role={statusRole}>
        {status}
      </p>
      <div
        className="plot-target"
        ref={target}
        data-sample-count={graph?.values[0].length ?? 0}
        data-time-start={graph?.values[0][0]}
        data-time-end={graph?.values[0].at(-1)}
      >
        {!graph && (
          <p className="plot-empty" role="status">
            {emptyMessage}
          </p>
        )}
      </div>
    </div>
  );
}
