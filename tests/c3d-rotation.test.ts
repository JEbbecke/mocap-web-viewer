import { beforeAll, describe, expect, it, vi } from 'vitest';
import * as h5 from 'h5wasm/node';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { parseC3D } from '../src/importers/c3d/importer';
import { readParameters } from '../src/importers/c3d/parameters';
import { rotationFixture } from './helpers/rotationC3d';
import { exportC3D } from '../src/exporters/c3d';
import { exportSemanticC3D } from '../src/exporters/semanticC3D';
import { writeSemanticH5 } from '../src/exporters/semanticH5';
import { conversionPlan } from '../src/exporters/conversion';
import { cropMotionData } from '../src/motion/crop';
import {
  setData,
  exportFile,
  useSession,
  applyCrop,
  undoEdit,
  redoEdit,
  renameSessionMarker,
  restoreOriginal,
  editSessionEvent,
  cancelImport,
} from '../src/state/session';
import { ExportControl } from '../src/components/ExportControl';
import { parseH5Tree } from '../src/importers/h5/schema';
import { physicalFixture } from './helpers/c3d';
import { editC3DParameters } from '../src/exporters/c3dParameters';

const folder = resolve('.local/rotation-export-validation');
beforeAll(async () => {
  await h5.ready;
  mkdirSync(folder, { recursive: true });
});

function setScalar(bytes: ArrayBuffer, key: string, value: number) {
  const view = new DataView(bytes);
  const { params, little } = readParameters(view);
  const s = params.get(key)!.storage!;
  if (s.kind === 4) view.setFloat32(s.offset, value, little);
  else view.setInt16(s.offset, value, little);
}

describe('separate C3D rotation extension', () => {
  it.each([true, false])(
    'keeps point/analog stride, clocks, labels and source frames (little=%s)',
    (little) => {
      const data = parseC3D(rotationFixture({ little }), 'synthetic.c3d');
      expect(data.timeline).toEqual({ rate: 100, frameCount: 3, firstFrame: 36, duration: 0.02 });
      expect(data.markers.labels).toEqual(['Alpha', 'Beta']);
      expect(data.source.originalPositionUnit).toBe('cm');
      expect(Array.from(data.markers.positions)).toEqual([
        10, 20, 30, 1000, 200, 300, 20, 20, 30, 1010, 200, 300, 30, 20, 30, 1020, 200, 300,
      ]);
      expect(Array.from(data.markers.valid)).toEqual([1, 1, 0, 1, 1, 1]);
      expect(Array.from(data.markers.residuals!)).toEqual([25, 15, -1, 15, 25, 15]);
      expect(data.analogs.map((a) => [a.name, a.unit, a.signal.rate])).toEqual([
        ['A1', 'V', 200],
        ['A2', 'N', 200],
      ]);
      expect(Array.from(data.analogs[0].signal.values)).toEqual([50, 50.5, 55, 55.5, 60, 60.5]);
      expect(Array.from(data.analogs[1].signal.values)).toEqual([
        -150, -150.75, -157.5, -158.25, -165, -165.75,
      ]);
      expect(data.events[0]).toMatchObject({ label: 'Step', sourceIndex: 0 });
      expect(data.events[0].time).toBeCloseTo(0.01);
      expect(data.source.partialImport).toEqual({
        omitted: 'C3D_ROTATION',
        rotation: {
          signals: 2,
          labels: ['Body', 'Tool'],
          rate: 200,
          ratio: 2,
          frames: 6,
          dataStartBlock: 6,
          byteOffset: 2560,
          byteLength: 816,
          encoding: 'column-major-4x4+reliability-float32',
        },
      });
      expect(data.rigidBodies).toBeUndefined();
      expect(data.warnings).toHaveLength(1);
      expect(data.warnings[0]).toContain('point and analog data are available');
      expect(data.warnings[0]).toContain('2 rotation signals were not imported');
    },
  );

  it('loads point-only sources with an accurate limitation message', () => {
    const data = parseC3D(rotationFixture({ analog: false, ratio: 1, unit: 'mm' }), 'points.c3d');
    expect(data.analogs).toEqual([]);
    expect(data.markers.positions[0]).toBe(1);
    expect(data.warnings[0]).toContain('point data is available');
    expect(data.source.partialImport!.rotation.frames).toBe(3);
  });

  it('does not warn for standard files or empty rotation groups', () => {
    const bytes = rotationFixture();
    setScalar(bytes, 'ROTATION:USED', 0);
    for (const source of [bytes, rotationFixture({ rotation: false })]) {
      const data = parseC3D(source, 'standard.c3d');
      expect(data.source.partialImport).toBeUndefined();
      expect(data.warnings).toEqual([]);
    }
  });

  it('validates declared rotation frames and rejects unknown encodings', () => {
    expect(
      parseC3D(rotationFixture({ declaredFrames: 6 }), 'declared.c3d').source.partialImport,
    ).toBeDefined();
    for (const frames of [3, 7, -1, NaN, 1e30])
      expect(() => parseC3D(rotationFixture({ declaredFrames: frames }), 'bad.c3d')).toThrow(
        'ROTATION:FRAMES',
      );
    expect(() => parseC3D(rotationFixture({ unknownEncoding: true }), 'unknown.c3d')).toThrow(
      'unrecognized rotation parameters',
    );
  });

  it.each([
    ['ROTATION:DATA_START', 5, 'DATA_START'],
    ['ROTATION:DATA_START', 7, 'DATA_START'],
    ['ROTATION:DATA_START', 0, 'DATA_START'],
    ['ROTATION:RATE', 123, 'RATE/RATIO'],
    ['ROTATION:RATE', NaN, 'finite numeric scalar'],
    ['ROTATION:RATIO', 0, 'RATE/RATIO'],
    ['ROTATION:RATIO', -1, 'RATE/RATIO'],
    ['ROTATION:USED', 3, 'LABELS'],
    ['POINT:SCALE', 0.5, 'floating-point'],
  ] as const)('rejects inconsistent %s=%s', (key, value, message) => {
    const bytes = rotationFixture();
    setScalar(bytes, key, value);
    expect(() => parseC3D(bytes, 'bad.c3d')).toThrow(message);
  });

  it('rejects missing offsets, unsupported layouts, malformed dimensions and label arrays', () => {
    for (const [key, action] of [
      ['ROTATION:DATA_START', 'rename'],
      ['ROTATION:USED', 'rename'],
      ['ROTATION:RATE', 'dimension'],
      ['ROTATION:LABELS', 'numeric'],
      ['ROTATION:LABELS', 'duplicate'],
    ]) {
      const bytes = rotationFixture();
      const view = new DataView(bytes);
      const { params } = readParameters(view);
      const s = params.get(key)!.storage!;
      if (action === 'rename') {
        const at = s.offset - 2 - key.split(':')[1].length - 2;
        view.setUint8(at, 'X'.charCodeAt(0));
      } else if (action === 'dimension') view.setUint8(s.offset - 1, 255);
      else if (action === 'numeric') view.setInt8(s.offset - 4, 1);
      else new Uint8Array(bytes).copyWithin(s.offset + 4, s.offset, s.offset + 4);
      expect(() => parseC3D(bytes, 'bad.c3d')).toThrow(/ROTATION|parameter/);
    }
  });

  it('rejects truncated points, truncated rotations, nonzero gaps and unexpected tails', () => {
    const source = rotationFixture();
    expect(() => parseC3D(source.slice(0, 2100), 'short.c3d')).toThrow('Truncated');
    expect(() => parseC3D(source.slice(0, -4), 'short.c3d')).toThrow('truncated rotation');
    const gap = source.slice(0);
    new Uint8Array(gap)[2300] = 1;
    expect(() => parseC3D(gap, 'gap.c3d')).toThrow('nonzero bytes');
    const padded = new Uint8Array(Math.ceil(source.byteLength / 512) * 512);
    padded.set(new Uint8Array(source));
    expect(parseC3D(padded.buffer, 'padded.c3d').source.partialImport).toBeDefined();
    padded[padded.length - 1] = 1;
    expect(() => parseC3D(padded.buffer, 'tail.c3d')).toThrow('nonzero bytes');
    const extra = new Uint8Array(4096);
    extra.set(new Uint8Array(source));
    expect(() => parseC3D(extra.buffer, 'tail.c3d')).toThrow('unexpected records');
  });

  it('keeps nonfinite point coordinates invalid without inventing values', () => {
    const source = rotationFixture();
    new DataView(source).setFloat32(2048, NaN, true);
    const data = parseC3D(source, 'invalid.c3d');
    expect(data.markers.positions[0]).toBeNaN();
    expect(data.markers.valid[0]).toBe(0);
  });

  it('reports source omissions once for both formats while preserving conversion details', () => {
    const bytes = rotationFixture();
    const data = parseC3D(bytes, 'partial.c3d');
    for (const target of ['C3D', 'H5'] as const) {
      const report = conversionPlan(data, target).report;
      expect(report.errors).toEqual([]);
      expect(report.included).toContain('1 events');
      expect(report.included.some((s) => /rotation/i.test(s))).toBe(false);
      expect(
        report.warnings.filter((s) => s.includes('2 rotation signals not imported')),
      ).toHaveLength(1);
      expect(report.warnings.join(' ')).toContain('Keep the original file');
      expect(report.warnings.filter((s) => /Existing import warnings/.test(s))).toHaveLength(0);
      expect(conversionPlan(data, target).report).toEqual(report);
    }
    expect(conversionPlan(data, 'H5').report.warnings.join(' ')).toContain('fourth component');
    expect(conversionPlan(data, 'C3D').report.included[0]).toBe('2 markers in cm');
    expect(data.warnings[0]).toContain('Exports will omit these signals.');
    for (const target of ['C3D', 'H5'] as const) {
      const standard = parseC3D(rotationFixture({ rotation: false }), 'standard.c3d');
      expect(conversionPlan(standard, target).report.warnings.join(' ')).not.toContain('rotation');
    }
  });

  it.each([true, false])(
    'exports clean C3D records without stale Rotation references (little=%s)',
    (little) => {
      const bytes = rotationFixture({ little });
      const snapshot = bytes.slice(0);
      const data = parseC3D(bytes, 'partial.c3d');
      for (const [start, end] of [
        [0, 3],
        [1, 3],
      ]) {
        const expected = cropMotionData(data, start, end);
        const output = exportC3D(
          bytes,
          start,
          end,
          expected.events,
          ['Renamed', 'Beta'],
          ['New1', 'New2'],
        );
        const actual = parseC3D(output, 'exported.c3d');
        expect(actual.timeline).toEqual(expected.timeline);
        expect(actual.markers).toEqual({
          ...expected.markers,
          connectionLabels: undefined,
          labels: ['Renamed', 'Beta'],
        });
        expect(actual.source.originalPositionUnit).toBe('cm');
        expect(actual.analogs).toEqual(
          expected.analogs.map((a, i) => ({ ...a, name: ['New1', 'New2'][i] })),
        );
        expect(actual.events.map((e) => e.label)).toEqual(expected.events.map((e) => e.label));
        for (const [i, event] of actual.events.entries())
          expect(event.time).toBeCloseTo(expected.events[i].time, 6);
        expect(actual.source.partialImport).toBeUndefined();
        expect(actual.warnings).toEqual([]);
        expect(
          [...readParameters(new DataView(output)).params.keys()].some((key) =>
            key.startsWith('ROTATION:'),
          ),
        ).toBe(false);
        expect(output.byteLength).toBeLessThanOrEqual(
          data.source.partialImport!.rotation.byteOffset,
        );
      }
      // Full-range copies must omit the payload too, even without edits/cropping.
      expect(parseC3D(exportC3D(bytes, 0, 3), 'copy.c3d').source.partialImport).toBeUndefined();
      expect(bytes).toEqual(snapshot);
    },
  );

  it('exports and re-imports H5 with supported samples, labels, units, clocks and events', () => {
    const data = cropMotionData(parseC3D(rotationFixture(), 'partial.c3d'), 1, 3);
    const output = new h5.File(resolve(folder, 'supported-subset.h5'), 'w');
    try {
      writeSemanticH5(output, data);
      const actual = parseH5Tree(output, 'exported.h5');
      expect(actual.timeline).toEqual(data.timeline);
      expect(actual.markers.labels).toEqual(data.markers.labels);
      expect(actual.markers.positions).toEqual(Float64Array.from(data.markers.positions));
      expect(actual.markers.valid).toEqual(data.markers.valid);
      expect(actual.markers.residuals).toEqual(Float64Array.from(data.markers.residuals!));
      expect(
        actual.analogs.map((a) => [a.name, a.unit, a.signal.rate, ...a.signal.values]),
      ).toEqual(data.analogs.map((a) => [a.name, a.unit, a.signal.rate, ...a.signal.values]));
      expect(actual.events).toHaveLength(data.events.length);
      actual.events.forEach((e, i) => expect(e.time).toBeCloseTo(data.events[i].time, 6));
      expect(actual.rigidBodies ?? []).toEqual([]);
      expect(output.get('ROTATION')).toBeNull();
    } finally {
      output.close();
    }
  });

  it.each([2, 3, 4] as const)(
    'preserves TYPE-%s forces and unrelated parameters when stripping rotations',
    (type) => {
      const source = physicalFixture(type);
      const rotationStart = Math.ceil(source.byteLength / 512) * 512;
      const original = parseC3D(source, 'standard.c3d');
      const editor = editC3DParameters(source, 'ROTATION');
      const scalar = (name: string, value: number, floating = false) => {
        const raw = new Uint8Array(floating ? 4 : 2);
        const view = new DataView(raw.buffer);
        if (floating) view.setFloat32(0, value, true);
        else view.setUint16(0, value, true);
        editor.parameter(name, raw.length, [], raw);
      };
      scalar('USED', 1);
      scalar('DATA_START', rotationStart / 512 + 1);
      scalar('RATE', 200, true);
      scalar('RATIO', 1);
      editor.parameter('LABELS', -1, [4, 1], new TextEncoder().encode('Body'));
      const withParameters = editor.finish();
      const extended = new Uint8Array(rotationStart + 400 * 68);
      extended.set(new Uint8Array(withParameters));
      // Omitted records need only a verified extent; no rotation samples are used.
      const imported = parseC3D(extended.buffer, 'partial.c3d');
      const exported = exportC3D(extended.buffer, 10, 20);
      const actual = parseC3D(exported, 'supported.c3d');
      const expected = cropMotionData(original, 10, 20);
      expect(actual.forcePlatforms).toEqual(expected.forcePlatforms);
      expect(actual.analogs).toEqual(expected.analogs);
      expect(actual.events).toEqual(expected.events);
      expect(
        readParameters(new DataView(exported)).params.get('VENDOR:CALIBRATION')?.values,
      ).toEqual(readParameters(new DataView(source)).params.get('VENDOR:CALIBRATION')?.values);
      expect(conversionPlan(imported, 'C3D').report.errors).toEqual([]);
      // Real baseline requirements still reject exclusion, while empty groups do not.
      setScalar(extended.buffer, 'FORCE_PLATFORM:ZERO', 1);
      const { params } = readParameters(new DataView(extended.buffer));
      new DataView(extended.buffer).setInt16(
        params.get('FORCE_PLATFORM:ZERO')!.storage!.offset + 2,
        40,
        true,
      );
      expect(() => exportC3D(extended.buffer, 10, 20)).toThrow('baseline');
      setScalar(extended.buffer, 'FORCE_PLATFORM:USED', 0);
      expect(() => exportC3D(extended.buffer, 10, 20)).not.toThrow();
    },
  );

  it('keeps unrelated validation errors blocking', () => {
    const data = parseC3D(rotationFixture(), 'partial.c3d');
    data.events[0].time = NaN;
    for (const target of ['C3D', 'H5'] as const)
      expect(conversionPlan(data, target).report.errors).toContain('An event has an invalid time.');
    const output = new h5.File(resolve(folder, 'invalid.h5'), 'w');
    try {
      expect(() => writeSemanticH5(output, data)).toThrow('invalid time');
    } finally {
      output.close();
    }
    const bad = rotationFixture();
    setScalar(bad, 'ROTATION:DATA_START', 5);
    expect(() => exportC3D(bad, 0, 3)).toThrow('DATA_START');
    expect(() => exportSemanticC3D(data)).toThrow();
  });

  it.each(['rotation', ' ROTATION '])(
    'removes the complete normalized %s group',
    (rotationGroupName) => {
      const source = rotationFixture({ rotationGroupName });
      const output = exportC3D(source, 0, 3);
      expect(
        [...readParameters(new DataView(output)).params.keys()].some((key) =>
          key.startsWith('ROTATION:'),
        ),
      ).toBe(false);
      expect(parseC3D(output, 'subset.c3d').warnings).toEqual([]);
    },
  );

  it('retains partial status through repeated crops, undo/redo and session export', () => {
    const data = parseC3D(rotationFixture(), 'partial.c3d');
    const cropped = cropMotionData(cropMotionData(data, 0, 3), 1, 3);
    expect(cropped.source.partialImport).toEqual(data.source.partialImport);
    expect(cropped.warnings).toEqual(data.warnings);
    expect(Array.from(cropped.markers.positions.slice(0, 3))).toEqual([20, 20, 30]);
    const workers: {
      postMessage: ReturnType<typeof vi.fn>;
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
    try {
      setData(data, new File(['synthetic'], 'partial.c3d'));
      useSession.setState({ cropSelection: { start: 1, end: 3 } });
      applyCrop();
      renameSessionMarker(0, 'Renamed');
      editSessionEvent('add', 0, { label: 'Added', context: '', time: 0.005 });
      for (const travel of [() => {}, undoEdit, redoEdit]) {
        travel();
        expect(useSession.getState().data!.source.partialImport).toEqual(data.source.partialImport);
        for (const target of ['C3D', 'H5'] as const) {
          exportFile(target);
          expect(useSession.getState().error).toBeNull();
          expect(workers.at(-1)!.postMessage).toHaveBeenCalled();
          cancelImport();
        }
      }
      restoreOriginal();
      expect(useSession.getState().data!.source.partialImport).toEqual(data.source.partialImport);
      expect(useSession.getState().data!.warnings).toEqual(data.warnings);
      setData(parseC3D(rotationFixture({ rotation: false }), 'new.c3d'));
      expect(useSession.getState().data!.source.partialImport).toBeUndefined();
      expect(useSession.getState().data!.warnings).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('enables the existing export toolbar without permanent restriction text', () => {
    const data = parseC3D(rotationFixture(), 'partial.c3d');
    const html = renderToStaticMarkup(createElement(ExportControl, { data, disabled: false }));
    expect(html).not.toContain('disabled=""');
    expect(html).not.toContain('Export unavailable');
    expect(html).not.toContain('export is blocked');
  });
});
