import { expect, it } from 'vitest';
import {
  boundSelection,
  cellSelected,
  copyColumn,
  copyFullTable,
  copySelectedColumns,
  copySelectedRows,
  columnSelected,
  copySelectedCells,
  selectCell,
  selectColumn,
  selectedCellCount,
  selectedColumns,
  rowSelected,
} from '../src/explorer/selection';
import { seriesDataset } from '../src/explorer/datasets';

const data = seriesDataset(
  'a',
  'Synthetic analog',
  ['Analog'],
  {
    values: new Float64Array([0.12345678901234567, 2, NaN, 4]),
    components: 1,
    rate: 10,
    startTime: 0,
  },
  'V',
);
it('copies an exact single cell and a rectangular range in table order', () => {
  const one = selectCell(null, { row: 0, column: 2 });
  expect(copySelectedCells(data, one)).toBe('0.12345678901234566');
  const rectangle = selectCell(one, { row: 2, column: 1 }, { extend: true });
  expect(selectedCellCount(rectangle)).toBe(6);
  expect(copySelectedCells(data, rectangle)).toBe('0\t0.12345678901234566\n0.1\t2\n0.2\tNaN');
  expect(data.cell(0, 2)).toBe(0.12345678901234567);
});
it('adds and removes noncontiguous cells without duplicating coordinates or scanning gap rows', () => {
  let s = selectCell(null, { row: 2, column: 2 });
  s = selectCell(s, { row: 0, column: 0 }, { toggle: true });
  expect(selectedCellCount(s)).toBe(2);
  expect(copySelectedCells(data, s)).toBe('0\t\n\tNaN');
  s = selectCell(s, { row: 2, column: 2 }, { toggle: true });
  expect(selectedCellCount(s)).toBe(1);
  expect(copySelectedCells(data, s)).toBe('0');
  s = selectCell(s, { row: 0, column: 0 }, { toggle: true });
  expect(selectedCellCount(s)).toBe(0);
  expect(copySelectedCells(data, s)).toBe('');
});
it('reverses shift ranges, removes an interior cell, and retains surrounding selected cells', () => {
  let s = selectCell(
    selectCell(null, { row: 3, column: 2 }),
    { row: 0, column: 0 },
    { extend: true },
  );
  expect(selectedCellCount(s)).toBe(12);
  s = selectCell(s, { row: 1, column: 1 }, { toggle: true });
  expect(selectedCellCount(s)).toBe(11);
  expect(cellSelected(s, { row: 1, column: 1 })).toBe(false);
  expect(cellSelected(s, { row: 1, column: 0 })).toBe(true);
  expect(cellSelected(s, { row: 1, column: 2 })).toBe(true);
  expect(copySelectedCells(data, s).split('\n')[1]).toBe('1\t\t2');
});
it('copies a full column with its unit heading, including values outside the viewport', () => {
  expect(copyColumn(data, 2)).toBe('Value [V]\n0.12345678901234566\n2\nNaN\n4');
  expect(copyColumn(data, 4)).toBe('');
  expect(selectedCellCount(selectColumn(2, 4))).toBe(4);
  expect(copySelectedCells(data, selectColumn(2, 4))).toBe('0.12345678901234566\n2\nNaN\n4');
});
it('represents large columns with bounded coordinates and copies sparse selections with only selected reads', () => {
  const column = selectColumn(2, 200000)!;
  expect(column.ranges).toHaveLength(1);
  expect(selectedCellCount(column)).toBe(200000);
  const removed = selectCell(column, { row: 100000, column: 2 }, { toggle: true });
  expect(removed.ranges).toHaveLength(2);
  expect(selectedCellCount(removed)).toBe(199999);
  let reads = 0;
  const large = {
    ...data,
    count: 200000,
    cell: (r: number, c: number) => {
      reads++;
      return r + c;
    },
  };
  const sparse = selectCell(
    selectCell(null, { row: 0, column: 2 }),
    { row: 199999, column: 2 },
    { toggle: true },
  );
  expect(copySelectedCells(large, sparse)).toBe('2\n200001');
  expect(reads).toBe(2);
});
it('bounds selection after data shrinks and handles empty datasets', () => {
  const s = selectColumn(2, 200000);
  expect(selectedCellCount(boundSelection(s, 3, 3))).toBe(3);
  expect(boundSelection(s, 3, 2)).toBeNull();
  expect(selectColumn(1, 0)).toBeNull();
  expect(copySelectedCells({ ...data, count: 0 }, s)).toBe('');
});

it('projects disjoint cell selections onto exactly their rows and columns', () => {
  const s = selectCell(
    selectCell(null, { row: 2, column: 2 }),
    { row: 0, column: 0 },
    { toggle: true },
  );
  expect(selectedColumns(s)).toEqual([0, 2]);
  expect([0, 1, 2, 3].map((r) => rowSelected(s, r))).toEqual([true, false, true, false]);
  expect([0, 1, 2].map((c) => columnSelected(s, c))).toEqual([true, false, true]);
  expect(copySelectedRows(data, s)).toBe(
    'Sample (0-based)\tTime [s]\tValue [V]\n0\t0\t0.12345678901234566\n2\t0.2\tNaN',
  );
  expect(copySelectedColumns(data, s)).toBe(
    'Sample (0-based)\tValue [V]\n0\t0.12345678901234566\n1\t2\n2\tNaN\n3\t4',
  );
});
it('copies overlapping selected row/column scopes once, in table order', () => {
  let s = selectCell(
    selectCell(null, { row: 0, column: 0 }),
    { row: 2, column: 2 },
    { extend: true },
  );
  s = selectCell(s, { row: 1, column: 1 }, { toggle: true });
  expect(copySelectedRows(data, s).split('\n')).toHaveLength(4);
  expect(copySelectedColumns(data, s)).toBe(copyFullTable(data));
});
it('copies the complete table independently of selection and viewport', () => {
  expect(copyFullTable(data)).toBe(
    'Sample (0-based)\tTime [s]\tValue [V]\n0\t0\t0.12345678901234566\n1\t0.1\t2\n2\t0.2\tNaN\n3\t0.3\t4',
  );
  expect(copyFullTable({ ...data, count: 0 })).toBe('Sample (0-based)\tTime [s]\tValue [V]');
  expect(copySelectedRows(data, null)).toBe('');
  expect(copySelectedColumns(data, null)).toBe('');
});
