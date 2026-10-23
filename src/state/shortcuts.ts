import { redoEdit, setFrame, togglePlay, undoEdit, useSession } from './session';
import {
  deleteSelectedMarker,
  fitScene,
  focusSelectedMarker,
  openSelectedMarkerMenu,
  renameSelectedMarker,
} from './markerCommands';

const EDITABLE = 'input,textarea,select,[contenteditable]:not([contenteditable="false"])';
const EDITOR = 'dialog,[role="dialog"],[role="menu"],[popover],.event-editor';
const WIDGET =
  'dialog,[role="dialog"],[role="menu"],[role="listbox"],[role="tree"],[role="grid"],[role="separator"],[popover],.event-editor,.signal-pane,.data-explorer';
const CONTROL =
  'button,a[href],summary,[role="button"],[role="tab"],[role="slider"],[role="checkbox"],[role="radio"],[role="combobox"],[tabindex]:not([tabindex="-1"]):not(.viewport)';
const closest = (event: KeyboardEvent, selector: string) =>
  (event.target as HTMLElement | null)?.closest?.(selector);

/** Leave native editing undo (including nested contenteditable elements) untouched. */
export function handleHistoryShortcut(event: KeyboardEvent) {
  if (
    event.defaultPrevented ||
    event.isComposing ||
    event.altKey ||
    !(event.ctrlKey || event.metaKey)
  )
    return false;
  if (event.repeat || closest(event, `${EDITABLE},${EDITOR}`)) return false;
  const key = event.key.toLowerCase();
  const undo = key === 'z' && !event.shiftKey;
  const redo =
    (key === 'z' && event.shiftKey) ||
    (key === 'y' && event.ctrlKey && !event.metaKey && !event.shiftKey);
  const state = useSession.getState();
  if (
    (!undo && !redo) ||
    !state.data ||
    state.busy ||
    !(undo ? state.history.past : state.history.future).length
  )
    return false;
  event.preventDefault();
  if (undo) undoEdit();
  else redoEdit();
  return true;
}

export interface ShortcutContext {
  viewerActive: boolean;
  closeExplorer: () => void;
}

/** One bubbling dispatcher. Local widgets get first refusal; only handled actions cancel defaults. */
export function handleApplicationShortcut(event: KeyboardEvent, context: ShortcutContext) {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return false;
  if (handleHistoryShortcut(event)) return true;
  if (
    event.key === 'Escape' &&
    !context.viewerActive &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !closest(event, `${EDITABLE},dialog,[role="dialog"],[role="menu"],[popover]`)
  ) {
    context.closeExplorer();
    event.preventDefault();
    return true;
  }
  if (closest(event, `${EDITABLE},${WIDGET}`) || event.altKey) return false;
  const s = useSession.getState();
  if (!s.data || s.busy || s.markerRename) return false;
  const key = event.key.toLowerCase();
  const control = closest(event, CONTROL);
  const markerContext =
    context.viewerActive && (!control || !!closest(event, '[data-marker-select]'));
  let handled = false;
  if (markerContext && !event.repeat) {
    if (key === 'u' && event.ctrlKey && event.shiftKey && !event.metaKey)
      handled = renameSelectedMarker();
    else if (!event.ctrlKey && !event.metaKey) {
      if (key === 'c' && !event.shiftKey) handled = focusSelectedMarker();
      else if (key === 'f' && !event.shiftKey) handled = fitScene();
      else if (key === 'delete' && !event.shiftKey) handled = deleteSelectedMarker();
      else if (key === 'f10' && event.shiftKey) {
        const anchor =
          closest(event, '[data-marker-select],.viewport') ?? document.querySelector('.viewport');
        const rect = anchor?.getBoundingClientRect();
        if (rect)
          handled = openSelectedMarkerMenu(rect.left + rect.width / 2, rect.top + rect.height / 2);
      }
    }
  }
  if (!handled && !control && !event.ctrlKey && !event.metaKey) {
    if (event.code === 'Space') {
      if (!event.repeat) {
        togglePlay();
        handled = true;
      }
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      useSession.setState({ playing: false });
      setFrame(s.frame + (event.key === 'ArrowRight' ? 1 : -1));
      handled = true;
    } else if (event.key === 'Home') {
      setFrame(0);
      handled = true;
    } else if (event.key === 'End') {
      setFrame(s.data.timeline.frameCount - 1);
      handled = true;
    }
  }
  if (handled) event.preventDefault();
  return handled;
}
