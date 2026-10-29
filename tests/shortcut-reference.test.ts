import { beforeEach, expect, it, vi } from 'vitest';
import { parseC3D } from '../src/importers/c3d/importer';
import fixtures from './fixtures/c3d.json';
import { shortcutReference } from '../src/state/shortcutReference';
import { handleApplicationShortcut } from '../src/state/shortcuts';
import { renameSessionMarker, setData, undoEdit, useSession } from '../src/state/session';

const applicationGroups = shortcutReference.filter((group) =>
  ['Playback', 'Camera & markers', 'Editing & history'].includes(group.title),
);
const bindings = applicationGroups.flatMap((group) =>
  group.entries
    .filter((entry) => !['Save label · label editor', 'Cancel label edit'].includes(entry.action))
    .flatMap((entry) =>
      entry.keys
        .flatMap((keys) =>
          keys
            .split(' / ')
            .flatMap((combo) =>
              combo.includes('Ctrl/Cmd')
                ? [combo.replace('Ctrl/Cmd', 'Ctrl'), combo.replace('Ctrl/Cmd', 'Cmd')]
                : [combo],
            ),
        )
        .map((combo) => ({ combo, action: entry.action })),
    ),
);

beforeEach(() => {
  setData(
    parseC3D(Uint8Array.from(Buffer.from(fixtures.intelFloat, 'base64')).buffer, 'shortcuts.c3d'),
  );
  useSession.setState({ viewerReady: true });
});
function keyEvent(combo: string, inDialog = false) {
  const tokens = combo.split('+');
  const name = tokens.at(-1)!;
  const key =
    ({ '←': 'ArrowLeft', '→': 'ArrowRight', Space: ' ' } as Record<string, string>)[name] ?? name;
  const anchor = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) };
  return {
    key,
    code: name === 'Space' ? 'Space' : key,
    ctrlKey: tokens.includes('Ctrl'),
    metaKey: tokens.includes('Cmd'),
    shiftKey: tokens.includes('Shift'),
    target: {
      closest: (selector: string) =>
        inDialog && selector.includes('dialog')
          ? {}
          : selector === '[data-marker-select],.viewport'
            ? anchor
            : null,
    },
    preventDefault: vi.fn(),
  } as unknown as KeyboardEvent;
}

it.each(bindings)(
  'the displayed $combo binding invokes the existing $action handler',
  ({ combo }) => {
    renameSessionMarker(0, 'History fixture');
    if (combo.endsWith('Y') || combo.includes('Shift+Z')) undoEdit();
    const event = keyEvent(combo);
    expect(handleApplicationShortcut(event, { viewerActive: true, closeExplorer: vi.fn() })).toBe(
      true,
    );
    expect(event.preventDefault).toHaveBeenCalledOnce();
  },
);

it.each(bindings)(
  'the displayed $combo binding cannot change the session behind a dialog',
  ({ combo }) => {
    renameSessionMarker(0, 'History fixture');
    const before = useSession.getState();
    const event = keyEvent(combo, true);
    expect(handleApplicationShortcut(event, { viewerActive: true, closeExplorer: vi.fn() })).toBe(
      false,
    );
    expect(useSession.getState()).toBe(before);
  },
);

it('keeps the documented application inventory explicit and excludes unsupported bindings', () => {
  expect(bindings.map(({ combo }) => combo)).toEqual([
    'Space',
    '←',
    '→',
    'Home',
    'End',
    'C',
    'F',
    'Ctrl+Shift+U',
    'Delete',
    'Shift+F10',
    'Ctrl+Z',
    'Cmd+Z',
    'Ctrl+Shift+Z',
    'Cmd+Shift+Z',
    'Ctrl+Y',
  ]);
  for (const combo of ['Cmd+Shift+U', 'Ctrl+O', '?', 'F1']) {
    expect(
      handleApplicationShortcut(keyEvent(combo), { viewerActive: true, closeExplorer: vi.fn() }),
    ).toBe(false);
  }
  const camera = shortcutReference.find((group) => group.title === 'Camera & markers')!;
  expect(camera.context).toMatch(/Data Visualizer.*selection/);
  expect(camera.entries[0].action).toContain('current valid sample');
});
