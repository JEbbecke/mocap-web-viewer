import { useMemo, useRef, useState } from 'react';
import { ResizeHandle } from '../layout/ResizeHandle';
import { splitSizes } from '../layout/geometry';
import { useElementSize } from '../layout/useElementSize';
import { SignalChart } from './SignalChart';
import { useModelSeries } from './useModelSeries';
import { ColumnSignals } from './ColumnSignals';
import type { MotionData } from '../motion/types';
import { markerIndex, markerSourceId } from '../motion/markerIdentity';
import { independentModelMessage } from '../motion/modelTiming';
import { selectPlot, useSession } from '../state/session';
import { plotSeries } from './series';
import { modelPlotData, modelPlotDescriptors } from './modelSeries';
import { SignalSelector } from './SignalSelector';
import { PanelToggle } from '../components/PanelToggle';
export function SignalPlot({
  data,
  collapsed,
  onToggle,
  explorer = false,
  height,
  empty = false,
}: {
  data: MotionData;
  collapsed: boolean;
  onToggle: () => void;
  explorer?: boolean;
  height?: number;
  empty?: boolean;
}) {
  const [split, setSplit] = useState(false);
  const [splitRatio, setSplitRatio] = useState(0.5);
  const panes = useRef<HTMLDivElement>(null);
  const paneSize = useElementSize(panes, !collapsed);
  const splitActive = split && !explorer;
  const { left: leftWidth, resizable: splitResizable } = splitSizes(paneSize.width, splitRatio);
  const [secondSelection, setSecondSelection] = useState('marker');
  const selection = useSession((s) => s.plot);
  return (
    <section
      id="signal-panel"
      className={`plot-panel ${collapsed ? 'is-collapsed' : ''}${empty ? ' is-empty' : ''}`}
      style={!collapsed && height !== undefined ? { height, flexBasis: height } : undefined}
    >
      <div className="panel-heading">
        <span>SIGNAL INSPECTOR</span>
        {!explorer && (
          <span className="muted">
            Scroll or drag to zoom · Click to scrub · Double-click to reset
          </span>
        )}
        <div className="plot-view-controls">
          {!explorer && (
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
          )}
          <PanelToggle panel="plot" expanded={!collapsed} onToggle={onToggle} />
        </div>
      </div>
      <div id="signal-panel-content" hidden={collapsed}>
        {!collapsed && (
          <div
            ref={panes}
            className={`plot-panes ${splitActive ? 'is-split' : ''}`}
            style={
              splitActive && splitResizable
                ? { gridTemplateColumns: `${leftWidth}px 0 minmax(250px, 1fr)` }
                : undefined
            }
          >
            {explorer ? (
              <ColumnSignals data={data} />
            ) : (
              <SignalPane data={data} selection={selection} onSelection={selectPlot} />
            )}
            {splitActive && (
              <div className="plot-divider">
                {splitResizable && (
                  <ResizeHandle
                    axis="horizontal"
                    label="Split plot widths"
                    controls="signal-panel-content"
                    value={leftWidth}
                    min={250}
                    max={paneSize.width - 250}
                    onChange={(value) => setSplitRatio(value / paneSize.width)}
                    onReset={() => setSplitRatio(0.5)}
                  />
                )}
              </div>
            )}
            {splitActive && (
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
  const selected = useSession((s) => s.selected);
  const models = useMemo(() => modelPlotDescriptors(data), [data]);
  const model = models.find((d) => d.id === requestedSelection);
  const { series: loaded, error: loadError } = useModelSeries(
    model && {
      kind: model.kind,
      sourceIndex: model.sourceIndex,
      range: model.range,
      timeOrigin: model.timeOrigin,
    },
  );
  const [kind, index, field] = requestedSelection.split(':');
  const valid =
    !!model ||
    requestedSelection === 'none' ||
    requestedSelection === 'marker' ||
    (Number.isInteger(Number(index)) &&
      Number(index) >= 0 &&
      (kind === 'marker'
        ? markerIndex(data, Number(index)) >= 0
        : kind === 'analog'
          ? Number(index) < data.analogs.length
          : kind === 'signal'
            ? Number(index) < (data.signals?.length ?? 0)
            : kind === 'plate' &&
              Number(index) < data.forcePlatforms.length &&
              (['force', 'moment', 'cop'].includes(field) ||
                (field === 'freeMoment' && !!data.forcePlatforms[Number(index)].freeMoment))));
  const selection = valid ? requestedSelection : kind === 'marker' ? 'none' : 'marker';
  const graph = useMemo(() => {
    if (selection === 'none') return null;
    if (!model) return plotSeries(data, selection, selected);
    return modelPlotData(loaded, model);
  }, [data, selection, selected, model, loaded]);

  return (
    <SignalChart
      data={data}
      graph={graph}
      croppedWithTrial={model ? model.aligned : true}
      secondary={secondary}
      statusRole={loadError ? 'alert' : 'status'}
      status={
        loadError ||
        (model && !graph
          ? 'Loading model signal...'
          : model && !model.aligned
            ? independentModelMessage
            : '')
      }
      toolbar={
        <SignalSelector
          label={secondary ? 'Second signal to plot' : 'Signal to plot'}
          value={selection}
          onChange={onSelection}
        >
          <option value="none">No signal</option>
          <option value="marker">
            Marker · {data.markers.labels[selected] ?? 'None selected'}
          </option>
          <optgroup label="Markers">
            {data.markers.labels.map((label, i) => (
              <option key={markerSourceId(data, i)} value={`marker:${markerSourceId(data, i)}`}>
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
            const signals = (data.signals ?? []).flatMap((s, i) =>
              s.group === group ? [{ ...s, index: i }] : [],
            );
            return (
              (descriptors.length > 0 || signals.length > 0) && (
                <optgroup key={kind} label={`${kind.toUpperCase()} Results`}>
                  {descriptors.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.label} ⋅ {d.unit}
                    </option>
                  ))}
                  {signals.map((s) => (
                    <option key={`signal:${s.index}`} value={`signal:${s.index}`}>
                      {kind.toUpperCase()} ⋅ {s.name} ⋅ {s.unit}
                    </option>
                  ))}
                </optgroup>
              )
            );
          })}
        </SignalSelector>
      }
    />
  );
}
