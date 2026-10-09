import { exactCell, type Dataset } from './datasets';

/** Dataset-scoped stable column identities; no sample arrays or page coordinates. */
export interface ColumnSelection {
  datasetId: string;
  columns: string[];
  anchor: string | null;
}
export function selectHeaderColumn(
  previous: ColumnSelection | null,
  datasetId: string,
  order: string[],
  column: string,
  modifiers: { extend?: boolean; toggle?: boolean } = {},
): ColumnSelection {
  const current = previous?.datasetId === datasetId ? previous : null;
  const anchor = current?.anchor && order.includes(current.anchor) ? current.anchor : null;
  let columns: string[];
  if (modifiers.extend && anchor) {
    const a = order.indexOf(anchor),
      b = order.indexOf(column);
    const range = order.slice(Math.min(a, b), Math.max(a, b) + 1);
    columns = modifiers.toggle ? [...(current?.columns ?? []), ...range] : range;
  } else if (modifiers.toggle && current) {
    columns = current.columns.includes(column)
      ? current.columns.filter((id) => id !== column)
      : [...current.columns, column];
  } else columns = [column];
  return {
    datasetId,
    columns: order.filter((id) => columns.includes(id)),
    anchor: modifiers.extend && anchor ? anchor : column,
  };
}

export interface CellAddress {
  row: number;
  column: number;
}
export interface CellRange {
  start: CellAddress;
  end: CellAddress;
}
/** Coordinates only, including whole columns; scientific values stay in their dataset. */
export interface CellSelection {
  anchor: CellAddress;
  active: CellAddress;
  ranges: CellRange[];
}

/** Project stable header IDs onto the current page only for table highlighting/copy. */
export function headerCellSelection(
  selection: ColumnSelection | null,
  datasetId: string,
  order: string[],
  count: number,
): CellSelection | null {
  if (!count || selection?.datasetId !== datasetId) return null;
  const indexes = order.flatMap((id, i) => (selection.columns.includes(id) ? [i] : []));
  if (!indexes.length) return null;
  const anchorIndex = order.indexOf(selection.anchor ?? '');
  const anchor = { row: 0, column: anchorIndex >= 0 ? anchorIndex : indexes[0] };
  return {
    anchor,
    active: { row: 0, column: indexes.at(-1)! },
    ranges: indexes.map((column) => ({
      start: { row: 0, column },
      end: { row: count - 1, column },
    })),
  };
}
const range = (a: CellAddress, b: CellAddress): CellRange => ({
  start: { row: Math.min(a.row, b.row), column: Math.min(a.column, b.column) },
  end: { row: Math.max(a.row, b.row), column: Math.max(a.column, b.column) },
});
const contains = (r: CellRange, c: CellAddress) =>
  c.row >= r.start.row &&
  c.row <= r.end.row &&
  c.column >= r.start.column &&
  c.column <= r.end.column;
export function cellSelected(s: CellSelection | null, c: CellAddress) {
  return s?.ranges.some((r) => contains(r, c)) ?? false;
}
export function rowSelected(s: CellSelection | null, row: number) {
  return s?.ranges.some((r) => row >= r.start.row && row <= r.end.row) ?? false;
}
export function columnSelected(s: CellSelection | null, column: number) {
  return s?.ranges.some((r) => column >= r.start.column && column <= r.end.column) ?? false;
}
export function selectCell(
  s: CellSelection | null,
  c: CellAddress,
  modifiers: { extend?: boolean; toggle?: boolean } = {},
): CellSelection {
  if (modifiers.extend && s) return { anchor: s.anchor, active: c, ranges: [range(s.anchor, c)] };
  if (!modifiers.toggle || !s) return { anchor: c, active: c, ranges: [range(c, c)] };
  const ranges: CellRange[] = [];
  for (const r of s.ranges) {
    if (!contains(r, c)) {
      ranges.push(r);
      continue;
    }
    // Removing one cell splits its rectangle into at most four disjoint ranges.
    if (r.start.row < c.row)
      ranges.push({ start: r.start, end: { row: c.row - 1, column: r.end.column } });
    if (c.row < r.end.row)
      ranges.push({ start: { row: c.row + 1, column: r.start.column }, end: r.end });
    if (r.start.column < c.column)
      ranges.push({
        start: { row: c.row, column: r.start.column },
        end: { row: c.row, column: c.column - 1 },
      });
    if (c.column < r.end.column)
      ranges.push({
        start: { row: c.row, column: c.column + 1 },
        end: { row: c.row, column: r.end.column },
      });
  }
  if (!cellSelected(s, c)) ranges.push(range(c, c));
  return { anchor: c, active: c, ranges };
}
export function selectColumn(column: number, count: number): CellSelection | null {
  return count
    ? {
        anchor: { row: 0, column },
        active: { row: 0, column },
        ranges: [range({ row: 0, column }, { row: count - 1, column })],
      }
    : null;
}
export function boundSelection(
  s: CellSelection | null,
  rows: number,
  columns: number,
): CellSelection | null {
  if (!s || !rows || !columns) return null;
  const ranges = s.ranges
    .filter((r) => r.start.row < rows && r.start.column < columns)
    .map((r) => ({
      ...r,
      end: { row: Math.min(r.end.row, rows - 1), column: Math.min(r.end.column, columns - 1) },
    }));
  if (!ranges.length) return null;
  const clamp = (c: CellAddress) => ({
    row: Math.min(c.row, rows - 1),
    column: Math.min(c.column, columns - 1),
  });
  return { anchor: clamp(s.anchor), active: clamp(s.active), ranges };
}
export function selectedCellCount(s: CellSelection | null) {
  return (
    s?.ranges.reduce(
      (n, r) => n + (r.end.row - r.start.row + 1) * (r.end.column - r.start.column + 1),
      0,
    ) ?? 0
  );
}
function intervals(values: [number, number][]) {
  const merged: [number, number][] = [];
  for (const [start, end] of values.sort((a, b) => a[0] - b[0])) {
    const last = merged.at(-1);
    if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}
export function selectedColumns(s: CellSelection | null) {
  return intervals(s?.ranges.map((r) => [r.start.column, r.end.column]) ?? []).flatMap(([a, b]) =>
    Array.from({ length: b - a + 1 }, (_, i) => a + i),
  );
}
/** Only text is materialized for copying; row intervals stay compact and ordered. */
function copyTablePart(d: Dataset, rows: [number, number][], columns: number[]) {
  if (!columns.length) return '';
  const lines = [columns.map((c) => d.columns[c].name).join('\t')];
  for (const [a, b] of rows)
    for (let r = a; r <= b; r++)
      lines.push(columns.map((c) => exactCell(d.cell(r, c)).replace(/[\t\r\n]+/g, ' ')).join('\t'));
  return lines.join('\n');
}
export function copySelectedRows(d: Dataset, selection: CellSelection | null) {
  const s = boundSelection(selection, d.count, d.columns.length);
  return copyTablePart(
    d,
    intervals(s?.ranges.map((r) => [r.start.row, r.end.row]) ?? []),
    s ? d.columns.map((_, i) => i) : [],
  );
}
export function copySelectedColumns(d: Dataset, selection: CellSelection | null) {
  const s = boundSelection(selection, d.count, d.columns.length);
  return copyTablePart(d, [[0, d.count - 1]], selectedColumns(s));
}
export function copyFullTable(d: Dataset) {
  return copyTablePart(
    d,
    [[0, d.count - 1]],
    d.columns.map((_, i) => i),
  );
}
/** TSV in table order, skipping entirely unselected rows/columns; gaps stay blank. */
export function copySelectedCells(d: Dataset, selection: CellSelection | null) {
  const s = boundSelection(selection, d.count, d.columns.length);
  if (!s) return '';
  if (selectedCellCount(s) === 1) {
    const c = s.ranges[0].start;
    return exactCell(d.cell(c.row, c.column));
  }
  const rows = intervals(s.ranges.map((r) => [r.start.row, r.end.row]));
  const columns = selectedColumns(s);
  const lines: string[] = [];
  for (const [a, b] of rows)
    for (let r = a; r <= b; r++)
      lines.push(
        columns
          .map((c) =>
            cellSelected(s, { row: r, column: c })
              ? exactCell(d.cell(r, c)).replace(/[\t\r\n]+/g, ' ')
              : '',
          )
          .join('\t'),
      );
  return lines.join('\n');
}
/** Whole current table column, materialized only for an explicit copy action. */
export function copyColumn(d: Dataset, column: number) {
  if (column < 0 || column >= d.columns.length) return '';
  return copyTablePart(d, [[0, d.count - 1]], [column]);
}
