/** Commands retain small edit payloads, never a recording or scientific arrays. */
export interface EditCommand<T> {
  readonly description: string;
  apply(value: T): T;
  revert(value: T): T;
}
interface Entry<T> {
  command: EditCommand<T>;
  before: number;
  after: number;
}
export interface EditHistory<T> {
  past: Entry<T>[];
  future: Entry<T>[];
  revision: number;
  nextRevision: number;
  cleanRevision: number;
}
export const HISTORY_LIMIT = 100;
export function emptyHistory<T>(modified = false): EditHistory<T> {
  return { past: [], future: [], revision: modified ? 1 : 0, nextRevision: 2, cleanRevision: 0 };
}
export function executeEdit<T>(history: EditHistory<T>, value: T, command: EditCommand<T>) {
  const next = command.apply(value);
  const entry = { command, before: history.revision, after: history.nextRevision };
  return {
    value: next,
    history: {
      ...history,
      past: [...history.past, entry].slice(-HISTORY_LIMIT),
      future: [],
      revision: entry.after,
      nextRevision: entry.after + 1,
    },
  };
}
export function travelHistory<T>(history: EditHistory<T>, value: T, direction: 'undo' | 'redo') {
  const undo = direction === 'undo';
  const entry = (undo ? history.past : history.future).at(-1);
  if (!entry) return { value, history };
  return {
    value: undo ? entry.command.revert(value) : entry.command.apply(value),
    history: {
      ...history,
      past: undo ? history.past.slice(0, -1) : [...history.past, entry],
      future: undo ? [...history.future, entry] : history.future.slice(0, -1),
      revision: undo ? entry.before : entry.after,
    },
  };
}
