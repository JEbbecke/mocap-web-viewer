/** Descriptive reference only, not a second dispatcher. Application bindings are
 * verified against shortcuts.ts; widget bindings are exercised by browser tests. */
export const shortcutReference = [
  {
    title: 'Playback',
    context: 'With a recording loaded; outside text fields, menus, plots and Explorer controls.',
    entries: [
      { action: 'Play / pause', keys: ['Space'] },
      { action: 'Previous / next frame · pauses playback', keys: ['← / →'] },
      { action: 'First / last frame', keys: ['Home / End'] },
    ],
  },
  {
    title: 'Camera & markers',
    context:
      'Data Visualizer; focus the Viewer or a marker row. Marker actions require a selection.',
    entries: [
      { action: 'Focus marker · current valid sample', keys: ['C'] },
      { action: 'Fit / reset scene', keys: ['F'] },
      { action: 'Rename marker', keys: ['Ctrl+Shift+U'] },
      { action: 'Delete marker trajectory · where supported', keys: ['Delete'] },
      { action: 'Open marker menu', keys: ['Shift+F10'] },
    ],
  },
  {
    title: 'Editing & history',
    context: 'Undo/redo require available edits, outside text fields, editors and dialogs.',
    entries: [
      { action: 'Undo', keys: ['Ctrl/Cmd+Z'] },
      { action: 'Redo', keys: ['Ctrl/Cmd+Shift+Z', 'Ctrl+Y'] },
      { action: 'Save label · label editor', keys: ['Enter'] },
      { action: 'Cancel label edit', keys: ['Escape'] },
    ],
  },
  {
    title: 'Timeline',
    context: 'Focus the playhead or a crop handle; movement stays within its allowed range.',
    entries: [
      { action: 'Move one frame', keys: ['← / ↓', '→ / ↑'] },
      { action: 'Move ten frames', keys: ['Page Down / Page Up'] },
      { action: 'First / last allowed position', keys: ['Home / End'] },
    ],
  },
  {
    title: 'Data Explorer',
    context: 'Focus the numerical table. Selected browser text keeps native copying.',
    entries: [
      { action: 'Select focused cell / column', keys: ['Enter / Space'] },
      { action: 'Extend cell selection', keys: ['Shift+Arrow keys'] },
      { action: 'Copy selected cells · exact values', keys: ['Ctrl/Cmd+C'] },
      { action: 'Go to sample · model sample input', keys: ['Enter'] },
      { action: 'Return to Visualizer · outside local editors / popups', keys: ['Escape'] },
    ],
  },
  {
    title: 'Menus & dialogs',
    context: 'When the menu or dialog supports the action.',
    entries: [
      { action: 'Navigate menu items', keys: ['↑ / ↓', 'Home / End'] },
      { action: 'Activate focused button / item', keys: ['Enter / Space'] },
      { action: 'Close menu / dialog', keys: ['Escape'] },
    ],
  },
  {
    title: 'Panel resizing',
    context: 'Focus a resize handle; use arrows along its direction.',
    entries: [
      { action: 'Resize by 10 pixels', keys: ['Arrow keys'] },
      { action: 'Resize by 40 pixels', keys: ['Shift+Arrow keys'] },
      { action: 'Reset panel size', keys: ['Home'] },
    ],
  },
] as const;
