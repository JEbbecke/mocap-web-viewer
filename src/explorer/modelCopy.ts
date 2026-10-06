import { exactCell } from './datasets';
import { readModelPage, type ModelPage, type ModelRequest } from './modelPage';

/** Read a complete current model table/columns in small slices inside the local worker.
 * The clipboard text is accumulated; complete scientific arrays are never loaded. */
export function readModelText(
  group: Parameters<typeof readModelPage>[0],
  request: ModelRequest,
  headers: string[],
  selected: number[] = headers.map((_, i) => i),
) {
  const columns = [...new Set(selected)].sort((a, b) => a - b);
  if (
    headers.length !== 4 ||
    !columns.length ||
    columns.some((c) => !Number.isInteger(c) || c < 0 || c >= 4)
  )
    throw Error('Unsupported model table columns.');
  let page: ModelPage = readModelPage(group, { ...request, offset: 0 });
  const chunks = [columns.map((c) => headers[c]).join('\t')];
  let lastTime = -Infinity;
  while (page.values.length) {
    if (page.clockKnown && page.times[0] <= lastTime)
      throw Error('Model clock must be finite and strictly increasing.');
    const rows: string[] = [];
    for (let i = 0; i < page.values.length; i++) {
      const cell = (c: number) =>
        c === 0
          ? page.offset + i
          : c === 1
            ? page.sourceOffset + i
            : c === 2
              ? page.times[i]
              : page.values[i];
      rows.push(columns.map((c) => exactCell(cell(c))).join('\t'));
    }
    chunks.push(rows.join('\n'));
    lastTime = page.times.at(-1)!;
    const next = page.offset + page.values.length;
    if (next >= page.total) break;
    page = readModelPage(group, { ...request, offset: next });
  }
  return chunks.join('\n');
}
