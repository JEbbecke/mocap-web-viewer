import { afterEach, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ImportWarnings } from '../src/components/ImportWarnings';
import { parseC3D } from '../src/importers/c3d/importer';
import { conversionPlan } from '../src/exporters/conversion';
import { cancelImport, openFile, useSession } from '../src/state/session';
import { rotationFixture } from './helpers/rotationC3d';

afterEach(() => {
  cancelImport();
  useSession.setState(useSession.getInitialState(), true);
  vi.unstubAllGlobals();
});

it('renders the existing import notes with native, accessible dismissal controls', () => {
  const data = parseC3D(rotationFixture(), 'partial.c3d');
  data.warnings.push('Another import limitation.');
  const before = structuredClone(data);
  const reports = ['C3D', 'H5'].map(
    (format) => conversionPlan(data, format as 'C3D' | 'H5').report,
  );
  const view = renderToStaticMarkup(createElement(ImportWarnings, { data }));
  expect(view).toContain('2 import notes');
  expect(view).toContain('rotation data was not imported');
  for (const message of data.warnings) expect(view).toContain(message);
  expect(view.match(/aria-label="Dismiss warning"/g)).toHaveLength(2);
  expect(view).toContain('type="button" class="warning-dismiss warning-dismiss-all"');
  expect(view).toContain('aria-label="Dismiss all import warnings"');
  expect(view).toContain('aria-hidden="true">×</span>');
  expect(data).toEqual(before);
  expect(
    ['C3D', 'H5'].map((format) => conversionPlan(data, format as 'C3D' | 'H5').report),
  ).toEqual(reports);
});

it('does not render a banner or dismiss controls for a warning-free import', () => {
  const data = parseC3D(rotationFixture({ rotation: false }), 'standard.c3d');
  expect(renderToStaticMarkup(createElement(ImportWarnings, { data }))).toBe('');
});

it('keeps newer warnings and errors when superseded import callbacks arrive late', () => {
  const workers: {
    onmessage?: (event: { data: unknown }) => void;
    onerror?: (event: { message: string }) => void;
    terminate: ReturnType<typeof vi.fn>;
  }[] = [];
  vi.stubGlobal(
    'Worker',
    class {
      postMessage = vi.fn();
      terminate = vi.fn();
      constructor() {
        workers.push(this);
      }
    },
  );
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')));
  const file = new File(['synthetic'], 'partial.c3d');
  const data = parseC3D(rotationFixture(), file.name);
  openFile(file);
  openFile(file);
  expect(workers[0].terminate).toHaveBeenCalled();
  workers[1].onmessage?.({ data: { data } });
  const imported = useSession.getState().data!;
  expect(imported.warnings).toEqual(data.warnings);
  expect(imported.source.partialImport).toEqual(data.source.partialImport);
  const scope = imported.source.filesystem;
  workers[0].onmessage?.({
    data: { data: { ...data, warnings: ['Stale warning from the superseded operation.'] } },
  });
  workers[0].onmessage?.({ data: { error: 'Stale import error.' } });
  workers[0].onerror?.({ message: 'Stale worker failure.' });
  expect(useSession.getState()).toMatchObject({ data: imported, error: null, busy: false });
  // Even reusing exactly the same File creates a fresh presentation scope.
  openFile(file);
  workers[2].onmessage?.({ data: { data } });
  expect(useSession.getState().data!.source.filesystem).not.toBe(scope);
  openFile(new File(['invalid'], 'invalid.h5'));
  workers[3].onmessage?.({ data: { error: 'Unsupported H5 schema.' } });
  expect(useSession.getState().error).toBe('Unsupported H5 schema.');
  expect(useSession.getState().data!.warnings).toEqual(data.warnings);
});
