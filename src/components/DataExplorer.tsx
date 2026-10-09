import { independentModelMessage } from '../motion/modelTiming';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MotionData } from '../motion/types';
import { setFrame, useSession } from '../state/session';
import {
  displayCell,
  exactCell,
  explorerDatasets,
  filterDatasets,
  rowWindow,
  ROW_HEIGHT,
  type Dataset,
} from '../explorer/datasets';
import { MODEL_PAGE_SIZE, type ModelPage, type ModelRequest } from '../explorer/modelPage';
import {
  boundSelection,
  cellSelected,
  columnSelected,
  copyFullTable,
  copySelectedColumns,
  copySelectedRows,
  copySelectedCells,
  selectCell,
  selectHeaderColumn,
  headerCellSelection,
  type CellAddress,
  selectedColumns,
  selectedCellCount,
  rowSelected,
  type CellSelection,
} from '../explorer/selection';
import './dataExplorer.css';

function Navigation({
  datasets,
  depth = 0,
  onSelect,
  selected,
  searching = false,
}: {
  datasets: Dataset[];
  depth?: number;
  onSelect: (id: string) => void;
  selected: string;
  searching?: boolean;
}) {
  const groups = new Map<string, Dataset[]>();
  const leaves: Dataset[] = [];
  for (const d of datasets) {
    const name = d.path[depth];
    if (!name || (depth > 0 && name === d.name && d.path.length === depth + 1)) leaves.push(d);
    else {
      const group = groups.get(name);
      if (group) group.push(d);
      else groups.set(name, [d]);
    }
  }
  return (
    <>
      {[...groups].map(([name, items]) => (
        <details open={searching} key={name}>
          <summary>
            {name} <span>{items.length}</span>
          </summary>
          <Navigation
            datasets={items}
            depth={depth + 1}
            onSelect={onSelect}
            selected={selected}
            searching={searching}
          />
        </details>
      ))}
      {leaves.map((d) => (
        <button
          key={d.id}
          aria-pressed={selected === d.id}
          title={[...d.path, d.name].join(' / ')}
          onClick={() => onSelect(d.id)}
        >
          {d.name}
          <small>{d.path.join(' / ')}</small>
        </button>
      ))}
    </>
  );
}

function NumericalTable({
  dataset,
  follow,
  pointRate,
  prepareTableCopy,
}: {
  dataset: Dataset;
  follow: boolean;
  pointRate: number;
  prepareTableCopy?: (columns?: number[]) => Promise<string>;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0),
    [height, setHeight] = useState(400);
  const [selection, setSelected] = useState<CellSelection | null>(null),
    [status, setStatus] = useState(''),
    [copying, setCopying] = useState(false);
  const headers = useSession((s) => s.explorerColumns);
  const bounded = useMemo(
    () =>
      headers?.datasetId === dataset.id
        ? headerCellSelection(
            headers,
            dataset.id,
            dataset.columns.map((c) => c.id),
            dataset.count,
          )
        : boundSelection(selection, dataset.count, dataset.columns.length),
    [headers, selection, dataset.id, dataset.count, dataset.columns],
  );
  const selectHeader = (column: string, modifiers: { extend?: boolean; toggle?: boolean }) => {
    setSelected(null);
    useSession.setState((state) => ({
      explorerDataset: dataset.id,
      explorerColumns: selectHeaderColumn(
        state.explorerColumns,
        dataset.id,
        dataset.columns.map((c) => c.id),
        column,
        modifiers,
      ),
    }));
  };
  const selectTableCell = (
    cell: CellAddress,
    modifiers: { extend?: boolean; toggle?: boolean } = {},
  ) => {
    setSelected(selectCell(bounded, cell, modifiers));
    useSession.setState({ explorerColumns: null });
  };
  const selected = bounded?.active;
  const headerSelected = (column: number) =>
    headers?.datasetId === dataset.id
      ? headers.columns.includes(dataset.columns[column].id)
      : columnSelected(bounded, column);
  const count = selectedCellCount(bounded);
  const frame = useSession((s) => s.frame);
  const current = dataset.current?.(frame / pointRate) ?? -1;
  const window = rowWindow(dataset.count, scrollTop, height);
  useEffect(() => {
    const element = viewport.current!;
    const observer = new ResizeObserver(() => setHeight(element.clientHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!follow || current < 0 || current >= dataset.count) return;
    const el = viewport.current!;
    const top = current * ROW_HEIGHT;
    if (top < el.scrollTop || top + 2 * ROW_HEIGHT > el.scrollTop + el.clientHeight)
      el.scrollTop = top;
  }, [follow, current, dataset.count]);
  const copy = async (prepare: () => string | Promise<string>) => {
    setCopying(true);
    setStatus('Preparing copy…');
    let text: string;
    try {
      text = await prepare();
    } catch (error) {
      setStatus(
        `Copy could not be prepared: ${error instanceof Error ? error.message : 'Local data unavailable.'}`,
      );
      setCopying(false);
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setStatus('Copied exact values.');
    } catch {
      setStatus('Clipboard unavailable. Select table text and use Ctrl/Cmd+C.');
    } finally {
      setCopying(false);
    }
  };
  const seek = () => {
    if (!selected || !dataset.seek) return;
    const time = dataset.seek(selected.row);
    if (!Number.isFinite(time)) return;
    useSession.setState({ playing: false });
    setFrame(time * pointRate);
  };
  return (
    <>
      <div className="explorer-table-tools">
        <span>{dataset.count.toLocaleString()} rows · read-only</span>
        <button
          disabled={!selected || copying}
          onClick={() => bounded && copy(() => copySelectedCells(dataset, bounded))}
        >
          Copy selected cell(s)
        </button>
        <button
          disabled={!selected || copying}
          title="Copy every row in all columns containing selected cells, including other model pages."
          onClick={() =>
            bounded &&
            copy(() =>
              prepareTableCopy
                ? prepareTableCopy(selectedColumns(bounded))
                : copySelectedColumns(dataset, bounded),
            )
          }
        >
          Copy selected column(s)
        </button>
        <button
          disabled={!selected || copying}
          onClick={() => bounded && copy(() => copySelectedRows(dataset, bounded))}
        >
          Copy selected row(s)
        </button>
        <button
          disabled={!dataset.count || copying}
          title="Copy every row and column in this dataset, including rows outside the viewport and other model pages."
          onClick={() =>
            copy(() => (prepareTableCopy ? prepareTableCopy() : copyFullTable(dataset)))
          }
        >
          Copy full table
        </button>
        {dataset.seek && (
          <button disabled={!selected} onClick={seek}>
            Seek to event
          </button>
        )}
        <span role="status">{status}</span>
      </div>
      <p className="explorer-selection-help">
        Click a cell · Shift-click a range · Ctrl/Cmd-click to add or remove cells · Click a header
        to select columns (Ctrl/Cmd toggles, Shift selects a range)
        {count ? ` · ${count.toLocaleString()} selected` : ''}
      </p>
      <div
        className="explorer-scroll"
        ref={viewport}
        tabIndex={0}
        aria-label={`${dataset.name} numerical table, scroll to inspect rows`}
        onCopy={(e) => {
          if (bounded && globalThis.getSelection()?.isCollapsed !== false) {
            e.preventDefault();
            e.clipboardData.setData('text/plain', copySelectedCells(dataset, bounded));
            setStatus('Copied exact values.');
          }
        }}
        onKeyDown={(e) => {
          if (
            [
              'ArrowUp',
              'ArrowDown',
              'ArrowLeft',
              'ArrowRight',
              'Home',
              'End',
              'PageUp',
              'PageDown',
              ' ',
            ].includes(e.key)
          )
            e.stopPropagation();
        }}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      >
        <table
          aria-label={dataset.path.concat(dataset.name).join(' / ')}
          aria-rowcount={dataset.count + 1}
        >
          <thead>
            <tr>
              {dataset.columns.map((c, i) => (
                <th
                  scope="col"
                  key={c.id}
                  className={`${c.numeric ? 'numeric' : ''} ${headerSelected(i) ? 'selected-column' : ''}`}
                >
                  <button
                    className="explorer-column-select"
                    title={`Select column: ${c.name}`}
                    aria-pressed={headerSelected(i)}
                    onMouseDown={(e) => {
                      if (e.shiftKey || e.ctrlKey || e.metaKey) e.preventDefault();
                    }}
                    onClick={(e) => {
                      if (e.shiftKey || e.ctrlKey || e.metaKey)
                        globalThis.getSelection()?.removeAllRanges();
                      selectHeader(c.id, { extend: e.shiftKey, toggle: e.ctrlKey || e.metaKey });
                      viewport.current?.focus({ preventScroll: true });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        e.stopPropagation();
                        selectHeader(c.id, { extend: e.shiftKey, toggle: e.ctrlKey || e.metaKey });
                      }
                    }}
                  >
                    {c.name}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {window.start > 0 && (
              <tr aria-hidden="true" className="explorer-spacer">
                <td
                  colSpan={dataset.columns.length}
                  style={{ height: window.start * ROW_HEIGHT }}
                />
              </tr>
            )}
            {Array.from({ length: window.end - window.start }, (_, i) => i + window.start).map(
              (r) => (
                <tr
                  key={r}
                  data-row={r}
                  aria-rowindex={r + 2}
                  className={`${r === current ? 'current-sample' : ''} ${rowSelected(bounded, r) ? 'selected-row' : ''}`}
                >
                  {dataset.columns.map((c, i) => {
                    const value = dataset.cell(r, i),
                      exact = exactCell(value);
                    return (
                      <td
                        key={i}
                        className={`${c.numeric ? 'numeric' : ''} ${rowSelected(bounded, r) || columnSelected(bounded, i) ? 'selection-axis' : ''} ${cellSelected(bounded, { row: r, column: i }) ? 'selected-cell' : ''}`}
                        title={exact}
                        tabIndex={0}
                        onMouseDown={(e) => {
                          if (e.shiftKey || e.ctrlKey || e.metaKey) e.preventDefault();
                        }}
                        onClick={(e) => {
                          if (e.shiftKey || e.ctrlKey || e.metaKey)
                            globalThis.getSelection()?.removeAllRanges();
                          if (e.shiftKey || e.ctrlKey || e.metaKey)
                            e.currentTarget.focus({ preventScroll: true });
                          selectTableCell(
                            { row: r, column: i },
                            { extend: e.shiftKey, toggle: e.ctrlKey || e.metaKey },
                          );
                        }}
                        onKeyDown={(e) => {
                          const cell = { row: r, column: i };
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            e.stopPropagation();
                            selectTableCell(cell, {
                              extend: e.shiftKey,
                              toggle: e.ctrlKey || e.metaKey,
                            });
                          } else if (
                            e.shiftKey &&
                            ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)
                          ) {
                            e.preventDefault();
                            e.stopPropagation();
                            const next = {
                              row: Math.max(
                                0,
                                Math.min(
                                  dataset.count - 1,
                                  r + (e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0),
                                ),
                              ),
                              column: Math.max(
                                0,
                                Math.min(
                                  dataset.columns.length - 1,
                                  i + (e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0),
                                ),
                              ),
                            };
                            setSelected(
                              selectCell(bounded ?? selectCell(null, cell), next, { extend: true }),
                            );
                            useSession.setState({ explorerColumns: null });
                            const el = viewport.current!;
                            if (
                              next.row * ROW_HEIGHT < el.scrollTop ||
                              next.row * ROW_HEIGHT + 2 * ROW_HEIGHT >
                                el.scrollTop + el.clientHeight
                            )
                              el.scrollTop = next.row * ROW_HEIGHT;
                            requestAnimationFrame(() =>
                              el
                                .querySelector<HTMLElement>(
                                  `tr[data-row="${next.row}"] td:nth-child(${next.column + 1})`,
                                )
                                ?.focus(),
                            );
                          }
                        }}
                      >
                        {displayCell(value)}
                      </td>
                    );
                  })}
                </tr>
              ),
            )}
            {window.end < dataset.count && (
              <tr aria-hidden="true" className="explorer-spacer">
                <td
                  colSpan={dataset.columns.length}
                  style={{ height: (dataset.count - window.end) * ROW_HEIGHT }}
                />
              </tr>
            )}
          </tbody>
        </table>
        {!dataset.count && (
          <p className="explorer-empty">No samples in the current recording interval.</p>
        )}
      </div>
      <div className="explorer-cell-value" aria-label="Exact selected value">
        {selected ? (
          <>
            <strong>
              {dataset.columns[selected.column].name} · row {selected.row + 1}
            </strong>
            <span>{exactCell(dataset.cell(selected.row, selected.column))}</span>
          </>
        ) : (
          <span>
            Select a cell to inspect its exact value. Text selection and Ctrl/Cmd+C are also
            available.
          </span>
        )}
      </div>
    </>
  );
}

function ModelTable({ dataset, data }: { dataset: Dataset; data: MotionData }) {
  const file = useSession((s) => s.sourceFile);
  const buffer = useRef<ModelPage | null>(null);
  const [offset, setOffset] = useState(0),
    [revision, setRevision] = useState(0),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  const model = dataset.model!;
  const request = useMemo<ModelRequest>(
    () => ({
      kind: model.kind,
      sourceIndex: model.sourceIndex,
      offset,
      range: model.range,
      timeOrigin: model.timeOrigin,
    }),
    [model.kind, model.sourceIndex, offset, model.range, model.timeOrigin],
  );
  const pendingCopy = useRef<{ worker: Worker; reject: (error: Error) => void } | null>(null);
  useEffect(
    () => () => {
      pendingCopy.current?.worker.terminate();
      pendingCopy.current?.reject(new Error('Copy cancelled.'));
      pendingCopy.current = null;
    },
    [file, request],
  );
  useEffect(() => {
    buffer.current = null;
    setLoading(true);
    setError('');
    if (!file) {
      setError('The original local file is unavailable for model inspection.');
      setLoading(false);
      return;
    }
    const worker = new Worker(new URL('../workers/explorer.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (event: MessageEvent<{ page?: ModelPage; error?: string }>) => {
      buffer.current = event.data.page ?? null;
      setError(event.data.error ?? '');
      setLoading(false);
      setRevision((r) => r + 1);
      worker.terminate();
    };
    worker.onerror = () => {
      setError('Local model inspection failed.');
      setLoading(false);
      worker.terminate();
    };
    worker.postMessage({ file, request });
    return () => worker.terminate();
  }, [file, request]);
  const page = buffer.current;
  const view = useMemo(() => {
    if (!page) return null;
    const d: Dataset = {
      ...dataset,
      count: page.values.length,
      cell: (r, c) =>
        c === 0
          ? page.offset + r
          : c === 1
            ? page.sourceOffset + r
            : c === 2
              ? page.times[r]
              : page.values[r],
    };
    return d;
  }, [dataset, page, model.unit, revision]);
  const prepareTableCopy = (columns?: number[]) =>
    new Promise<string>((resolve, reject) => {
      if (!file || !view) {
        reject(new Error('Local model data are unavailable.'));
        return;
      }
      const worker = new Worker(new URL('../workers/explorer.worker.ts', import.meta.url), {
        type: 'module',
      });
      pendingCopy.current = { worker, reject };
      const finish = () => {
        worker.terminate();
        pendingCopy.current = null;
      };
      worker.onmessage = (event: MessageEvent<{ text?: string; error?: string }>) => {
        finish();
        if (event.data.text !== undefined) resolve(event.data.text);
        else reject(new Error(event.data.error ?? 'Local model copying failed.'));
      };
      worker.onerror = () => {
        finish();
        reject(new Error('Local model copying failed.'));
      };
      worker.postMessage({
        file,
        request,
        copy: { headers: view.columns.map((c) => c.name), columns },
      });
    });
  return (
    <>
      <div className="explorer-pagination">
        <button
          disabled={loading || offset === 0}
          onClick={() => setOffset(Math.max(0, offset - MODEL_PAGE_SIZE))}
        >
          Previous samples
        </button>
        <span>
          {page
            ? page.total
              ? `${page.offset + 1}–${page.offset + page.values.length} of ${page.total} samples`
              : '0 samples'
            : 'Reading local model samples…'}
        </span>
        <button
          disabled={loading || !page || page.offset + page.values.length >= page.total}
          onClick={() => setOffset(offset + MODEL_PAGE_SIZE)}
        >
          Next samples
        </button>
        <label>
          Go to sample{' '}
          <input
            type="number"
            min="0"
            max={Math.max(0, (page?.total ?? 1) - 1)}
            defaultValue={offset}
            key={offset}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const n = Number(e.currentTarget.value);
                if (Number.isSafeInteger(n) && n >= 0 && n < (page?.total ?? 0))
                  setOffset(Math.floor(n / MODEL_PAGE_SIZE) * MODEL_PAGE_SIZE);
              }
            }}
          />
        </label>
      </div>
      <p className="small muted">
        {model.aligned
          ? 'Aligned model clock; samples are cropped with trial.'
          : independentModelMessage}
      </p>
      {page && !page.clockKnown && (
        <p className="small muted">No declared model clock; time values are unknown.</p>
      )}
      {loading ? (
        <p role="status" className="explorer-empty">
          Reading local model samples…
        </p>
      ) : error ? (
        <p role="alert" className="explorer-empty">
          {error}
        </p>
      ) : (
        view && (
          <NumericalTable
            key={`${dataset.id}:${offset}`}
            dataset={view}
            follow={false}
            pointRate={data.timeline.rate}
            prepareTableCopy={prepareTableCopy}
          />
        )
      )}
    </>
  );
}

export function DataExplorer({ data, onClose }: { data: MotionData; onClose: () => void }) {
  const datasets = useMemo(() => explorerDatasets(data), [data]);
  const [query, setQuery] = useState(''),
    [follow, setFollow] = useState(false);
  const selected = useSession((s) => s.explorerDataset);
  const selectDataset = (id: string) =>
    useSession.setState((state) => ({
      explorerDataset: id,
      explorerColumns: state.explorerDataset === id ? state.explorerColumns : null,
    }));
  const matches = useMemo(() => filterDatasets(datasets, query), [datasets, query]);
  const dataset = datasets.find((d) => d.id === selected) ?? datasets[0];
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        event.preventDefault();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  return (
    <section className="data-explorer" aria-label="Data Explorer">
      <div className="explorer-body">
        <nav className="explorer-navigation" aria-label="Explorer datasets">
          <input
            className="search"
            type="search"
            aria-label="Search explorer datasets"
            placeholder="Find a dataset by name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <p className="small muted">
            {matches.length} datasets{query ? ' match' : ''}
          </p>
          <Navigation
            datasets={matches}
            onSelect={selectDataset}
            selected={dataset?.id ?? ''}
            searching={!!query.trim()}
          />
          {!matches.length && <p className="small muted">No matching datasets.</p>}
        </nav>
        <div className="explorer-detail">
          {dataset ? (
            <>
              <div className="explorer-dataset-info">
                <div className="explorer-dataset-heading">
                  <div>
                    <p>{dataset.path.join(' / ')}</p>
                    <h3>{dataset.name}</h3>
                  </div>
                  {(dataset.current || dataset.model) && (
                    <label>
                      <input
                        type="checkbox"
                        checked={follow}
                        disabled={!!dataset.model}
                        onChange={(e) => setFollow(e.target.checked)}
                      />{' '}
                      Follow playback
                    </label>
                  )}
                </div>
                {!!dataset.facts.length && (
                  <details className="explorer-facts">
                    <summary>Units, clock and dataset details</summary>
                    <dl>
                      {dataset.facts.map(([key, value]) => (
                        <div key={key}>
                          <dt>{key}</dt>
                          <dd>{value}</dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                )}
              </div>
              {dataset.model ? (
                <ModelTable key={dataset.id} dataset={dataset} data={data} />
              ) : (
                <NumericalTable
                  key={`${dataset.id}:${data.timeline.firstFrame}:${dataset.count}`}
                  dataset={dataset}
                  follow={follow}
                  pointRate={data.timeline.rate}
                />
              )}
            </>
          ) : (
            <p className="explorer-empty">No supported datasets available.</p>
          )}
        </div>
      </div>
    </section>
  );
}
