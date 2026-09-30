import { redoEdit, undoEdit, useSession } from './session';

/** Leave native editing undo (including nested contenteditable elements) untouched. */
export function handleHistoryShortcut(event: KeyboardEvent) {
  if (
    event.defaultPrevented ||
    event.isComposing ||
    event.altKey ||
    !(event.ctrlKey || event.metaKey)
  )
    return false;
  const target = event.target as HTMLElement | null;
  if (target?.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])'))
    return false;
  const key = event.key.toLowerCase();
  const undo = key === 'z' && !event.shiftKey;
  const redo =
    (key === 'z' && event.shiftKey) ||
    (key === 'y' && event.ctrlKey && !event.metaKey && !event.shiftKey);
  const state = useSession.getState();
  if ((!undo && !redo) || !state.data || state.busy) return false;
  event.preventDefault();
  if (undo) undoEdit();
  else redoEdit();
  return true;
}
