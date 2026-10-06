import { expect, it } from 'vitest';
import { readModelText } from '../src/explorer/modelCopy';
import type { ModelRequest } from '../src/explorer/modelPage';

const headers = [
  'Sample (0-based)',
  'Source sample (0-based)',
  'Model time [s]',
  'Value [unknown]',
];
const request: ModelRequest = {
  kind: 'ik',
  sourceIndex: 1,
  offset: 600,
  timeBasis: 'independent',
  timeOrigin: 10,
};
function fixture(count = 1005, start = 0.25, step = 0.001) {
  const reads: number[] = [];
  return {
    reads,
    group: {
      get: (name: string) =>
        name === 'Data'
          ? {
              shape: [2, count],
              get value(): never {
                throw Error('Whole model arrays must not be loaded.');
              },
              slice: ([[r], [a, b]]: number[][]) => {
                reads.push(b - a);
                return Float64Array.from({ length: b - a }, (_, i) =>
                  r === 1 ? a + i + 4 : start + (a + i) * step,
                );
              },
            }
          : name === 'Time'
            ? {
                shape: [count],
                slice: ([[a, b]]: number[][]) => {
                  reads.push(b - a);
                  return Float64Array.from({ length: b - a }, (_, i) => start + (a + i) * step);
                },
              }
            : undefined,
    },
  };
}
it('copies every model page from sample zero, retaining its independent clock with bounded numerical reads', () => {
  const { group, reads } = fixture();
  const text = readModelText(group, request, headers);
  const rows = text.split('\n');
  expect(rows).toHaveLength(1006);
  expect(rows[0]).toBe(headers.join('\t'));
  expect(rows[1]).toBe('0\t0\t0.25\t4');
  expect(rows.at(-1)).toBe('1004\t1004\t1.254\t1008');
  expect(Math.max(...reads)).toBe(200);
});
it('copies selected model columns once in table order across every page', () => {
  const { group } = fixture();
  const rows = readModelText(group, request, headers, [3, 2, 3]).split('\n');
  expect(rows).toHaveLength(1006);
  expect(rows[0]).toBe('Model time [s]\tValue [unknown]');
  expect(rows[1]).toBe('0.25\t4');
  expect(rows.at(-1)).toBe('1.254\t1008');
});
it('copies the complete current trial crop, rebasing sample/time while retaining source sample indices', () => {
  const { group } = fixture(1005, 10, 0.01);
  const rows = readModelText(
    group,
    { ...request, timeBasis: 'trial', timeOrigin: 10.5, interval: { start: 10.5, end: 11.5 } },
    headers,
  ).split('\n');
  expect(rows).toHaveLength(101);
  expect(rows[1]).toBe('0\t50\t0\t54');
  const last = rows.at(-1)!.split('\t');
  expect(last[0]).toBe('99');
  expect(last[1]).toBe('149');
  expect(Number(last[2])).toBeCloseTo(0.99);
  expect(last[3]).toBe('153');
});
it('handles empty model tables and rejects unsupported copy columns', () => {
  const { group } = fixture(0);
  expect(readModelText(group, request, headers)).toBe(headers.join('\t'));
  expect(() => readModelText(group, request, headers, [4])).toThrow('columns');
});
