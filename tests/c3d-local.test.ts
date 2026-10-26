import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseC3D } from '../src/importers/c3d/importer';
import { exportC3D } from '../src/exporters/c3d';
import { conversionPlan } from '../src/exporters/conversion';
import { cropMotionData } from '../src/motion/crop';

/** Independent little-endian reference scanner: no production parameter decoder.
 * Reference bytes/labels never become fixtures, snapshots or deployed assets. */
function referenceParameters(bytes: Buffer) {
  const p = new Map<string, number[] | string[]>();
  const groups = new Map<number, string>();
  const start = (bytes[0] - 1) * 512;
  const limit = start + bytes[start + 2] * 512;
  let pos = start + 4;
  while (pos < limit && bytes.readInt8(pos)) {
    const n = Math.abs(bytes.readInt8(pos));
    const id = bytes.readInt8(pos + 1);
    const name = bytes.toString('utf8', pos + 2, pos + 2 + n).toUpperCase();
    const jumpAt = pos + 2 + n;
    const jump = bytes.readInt16LE(jumpAt);
    let at = jumpAt + 2;
    if (id < 0) groups.set(-id, name);
    else {
      const kind = bytes.readInt8(at++);
      const dims = bytes[at++];
      const dimensions = Array.from(bytes.subarray(at, at + dims));
      at += dims;
      const count = dimensions.reduce((a, b) => a * b, 1);
      const values =
        kind === -1
          ? Array.from({ length: count / (dimensions[0] || 1) }, (_, i) =>
              bytes
                .toString('utf8', at + i * dimensions[0], at + (i + 1) * dimensions[0])
                .replace(/\0/g, '')
                .trim(),
            )
          : Array.from({ length: count }, (_, i) =>
              kind === 4 ? bytes.readFloatLE(at + 4 * i) : bytes.readInt16LE(at + 2 * i),
            );
      p.set(`${groups.get(id)}:${name}`, values);
    }
    if (!jump) break;
    pos = jumpAt + jump;
  }
  return p;
}

describe('optional private C3D integration (read-only; never deployed)', () => {
  for (const spec of [
    {
      file: 'QTM_Example.c3d',
      size: 1326592,
      points: 68,
      frames: 394,
      firstFrame: 923,
      rate: 200,
      analogs: 56,
      analogRate: 2000,
      rotations: 0,
      pointEnd: 1326080,
      rotationStart: 0,
    },
    {
      file: 'XSENSE_example.c3d',
      size: 14705988,
      points: 87,
      frames: 3301,
      firstFrame: 0,
      rate: 240,
      analogs: 0,
      analogRate: 0,
      rotations: 45,
      pointEnd: 4604720,
      rotationStart: 4604928,
    },
    {
      file: 'XSENSE_example_2.c3d',
      size: 9550732,
      points: 87,
      frames: 2143,
      firstFrame: 1,
      rate: 240,
      analogs: 0,
      analogRate: 0,
      rotations: 45,
      pointEnd: 2992784,
      rotationStart: 2993152,
    },
  ]) {
    const path = `reference-data/${spec.file}`;
    it.skipIf(!existsSync(path))(
      `${spec.file}: all samples, labels, validity and export policy`,
      () => {
        const raw = readFileSync(path);
        const bytes = Uint8Array.from(raw).buffer;
        const p = referenceParameters(raw);
        const scalar = (key: string) => (p.get(key) as number[])[0];
        const values = (key: string) => p.get(key) as number[];
        const data = parseC3D(bytes, 'private.c3d');
        expect(raw.length).toBe(spec.size);
        expect(raw[(raw[0] - 1) * 512 + 3]).toBe(84);
        expect(data.timeline).toEqual({
          rate: spec.rate,
          frameCount: spec.frames,
          firstFrame: spec.firstFrame,
          duration: (spec.frames - 1) / spec.rate,
        });
        expect(data.markers.labels).toEqual(p.get('POINT:LABELS'));
        expect(data.markers.labels.length).toBe(spec.points);
        expect(data.source.originalPositionUnit).toBe('mm');
        expect(data.analogs.length).toBe(spec.analogs);
        expect(data.analogs.map((a) => a.name)).toEqual(p.get('ANALOG:LABELS'));
        expect(data.analogs.map((a) => a.unit)).toEqual(p.get('ANALOG:UNITS'));
        let at = (scalar('POINT:DATA_START') - 1) * 512;
        const subframes = spec.analogs ? spec.analogRate / spec.rate : 0;
        let pointMismatch = 0,
          validityMismatch = 0,
          residualMismatch = 0,
          analogMismatch = 0;
        for (let frame = 0; frame < spec.frames; frame++) {
          for (let marker = 0; marker < spec.points; marker++) {
            const index = frame * spec.points + marker;
            let finite = true;
            for (let axis = 0; axis < 3; axis++, at += 4) {
              const value = raw.readFloatLE(at);
              finite &&= Number.isFinite(value);
              if (!Object.is(data.markers.positions[index * 3 + axis], value)) pointMismatch++;
            }
            const packed = raw.readFloatLE(at);
            at += 4;
            const residual =
              packed < 0 ? -1 : (Math.trunc(packed) % 256) * Math.abs(scalar('POINT:SCALE'));
            if (!Object.is(data.markers.residuals![index], Math.fround(residual)))
              residualMismatch++;
            if (data.markers.valid[index] !== Number(packed >= 0 && finite)) validityMismatch++;
          }
          for (let sub = 0; sub < subframes; sub++)
            for (let channel = 0; channel < spec.analogs; channel++, at += 4) {
              const expected =
                (raw.readFloatLE(at) - values('ANALOG:OFFSET')[channel]) *
                values('ANALOG:SCALE')[channel] *
                scalar('ANALOG:GEN_SCALE');
              if (
                !Object.is(data.analogs[channel].signal.values[frame * subframes + sub], expected)
              )
                analogMismatch++;
            }
        }
        expect({ pointMismatch, validityMismatch, residualMismatch, analogMismatch }).toEqual({
          pointMismatch: 0,
          validityMismatch: 0,
          residualMismatch: 0,
          analogMismatch: 0,
        });
        for (const analog of data.analogs) {
          expect(analog.signal.rate).toBe(spec.analogRate);
          expect(analog.signal.values.length).toBe(spec.frames * subframes);
        }
        if (spec.rotations) {
          // Provider-confirmed acquisition is 60 Hz, but imported/exported timing
          // must still honor the unchanged 240 Hz metadata in these source files.
          expect(at).toBe(spec.pointEnd);
          const rotation = data.source.partialImport!.rotation;
          expect(rotation).toMatchObject({
            signals: spec.rotations,
            rate: spec.rate,
            frames: spec.frames,
            byteOffset: spec.rotationStart,
            byteLength: spec.frames * spec.rotations * 68,
          });
          expect(rotation.labels).toEqual(p.get('ROTATION:LABELS'));
          expect(rotation.byteOffset + rotation.byteLength).toBe(raw.length);
          // Check the claimed column-major 4x4 + reliability encoding throughout.
          let malformed = 0;
          for (let offset = rotation.byteOffset; offset < raw.length; offset += 68) {
            const matrix = Array.from({ length: 17 }, (_, i) => raw.readFloatLE(offset + i * 4));
            if (
              matrix.some((v) => !Number.isFinite(v)) ||
              matrix[3] !== 0 ||
              matrix[7] !== 0 ||
              matrix[11] !== 0 ||
              matrix[15] !== 1 ||
              matrix[16] !== 0
            )
              malformed++;
          }
          expect(malformed).toBe(0);
          const exported = exportC3D(bytes, 0, spec.frames);
          const reopened = parseC3D(exported, 'supported.c3d');
          expect(reopened.timeline).toEqual(data.timeline);
          expect(reopened.markers).toEqual(data.markers);
          expect(reopened.source.partialImport).toBeUndefined();
          expect(referenceParameters(Buffer.from(exported)).has('ROTATION:USED')).toBe(false);
          const cropped = cropMotionData(data, 10, 20);
          expect(cropped.source.partialImport).toEqual(data.source.partialImport);
          for (const target of ['C3D', 'H5'] as const) {
            const report = conversionPlan(cropped, target).report;
            expect(report.errors).toEqual([]);
            expect(
              report.warnings.filter((w) => w.includes('45 rotation signals not imported')),
            ).toHaveLength(1);
          }
          expect(parseC3D(exportC3D(bytes, 10, 20), 'cropped.c3d').markers.positions).toEqual(
            cropped.markers.positions,
          );
          expect(data.warnings).toHaveLength(1);
        } else {
          expect(data.source.partialImport).toBeUndefined();
          expect(data.warnings).toEqual([]);
          expect(exportC3D(bytes, 0, spec.frames)).toEqual(bytes);
          const cropped = parseC3D(exportC3D(bytes, 10, 20), 'cropped.c3d');
          expect(cropped.markers.positions).toEqual(cropMotionData(data, 10, 20).markers.positions);
        }
      },
    );
  }
});
