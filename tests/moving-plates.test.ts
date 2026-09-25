import { beforeAll, expect, it } from 'vitest';
import * as h5 from 'h5wasm/node';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseH5Tree } from '../src/importers/h5/schema';
import { createH5Output, writeCroppedH5 } from '../src/exporters/h5';
import { cropMotionData } from '../src/motion/crop';
import { sample } from '../src/motion/math';

// Real H5: corners and pose at 100 Hz, force/COP at 200 Hz, nonzero trial origin.
// Global corners translate and tilt; Position lies 50 mm below the plate surface.
beforeAll(async () => {
  await h5.ready;
  mkdirSync('.local', { recursive: true });
  const input = new h5.File(resolve('.local/moving-plates.h5'), 'w');
  try {
    const traj = input.create_group('Trajectories');
    traj.create_attribute('SamplingFrequency', 100);
    traj.create_attribute('StartFrame', 20);
    const labeled = traj.create_group('Labeled');
    labeled.create_attribute('Labels', ['Synthetic marker']);
    labeled.create_attribute('Unit', 'mm');
    labeled.create_dataset({
      name: 'Data',
      shape: [1, 4, 3],
      data: new Float64Array([0, 0, 0, 0, 0, 0, 1000, 1000, 1000, 1, 1, 1]),
    });
    labeled.create_dataset({ name: 'Time', data: new Float64Array([0.2, 0.21, 0.22]) });
    const plate = input.create_group('ForcePlates').create_group('0');
    for (const [key, value] of Object.entries({
      Name: 'Moving synthetic plate',
      SamplingFrequency: 200,
      CoordinateSystem: 1,
      unit_force: 'N',
      unit_moment: 'Nmm',
      unit_position: 'mm',
    }))
      plate.create_attribute(key, value);
    for (const name of ['Force', 'Moment', 'COP'])
      plate.create_dataset({ name, shape: [3, 6], data: new Float64Array(18) });
    plate.create_dataset({
      name: 'Time',
      data: new Float64Array([0.2, 0.205, 0.21, 0.215, 0.22, 0.225]),
    });
    const corners = new Float64Array(36),
      position = new Float64Array(9),
      rotation = new Float64Array(27);
    const local = [
      [-400, -300, 0],
      [400, -300, 0],
      [400, 300, 0],
      [-400, 300, 0],
    ];
    for (let f = 0; f < 3; f++) {
      const a = (f * Math.PI) / 4,
        c = Math.cos(a),
        s = Math.sin(a),
        center = [2000 + f * 1000, 0, 100 + f * 100];
      const r = [c, 0, s, 0, 1, 0, -s, 0, c];
      r.forEach((value, j) => (rotation[j * 3 + f] = value));
      [center[0] - s * 50, 0, center[2] - c * 50].forEach(
        (value, j) => (position[j * 3 + f] = value),
      );
      local.forEach(([x, y, z], j) =>
        [c * x + s * z + center[0], y, -s * x + c * z + center[2]].forEach(
          (value, k) => (corners[(k * 4 + j) * 3 + f] = value),
        ),
      );
    }
    plate.create_dataset({ name: 'Corners', shape: [3, 4, 3], data: corners });
    plate.create_dataset({ name: 'Position', shape: [3, 3], data: position });
    plate.create_dataset({ name: 'Rotation', shape: [3, 3, 3], data: rotation });
    plate.create_dataset({ name: 'Origin', shape: [3, 1], data: new Float64Array([0, 0, -50]) });
    input.flush();
  } finally {
    input.close();
  }
});

it('animates global marker-rate plate geometry independently of the force clock, including crop/export', async () => {
  const input = new h5.File(resolve('.local/moving-plates.h5'), 'r');
  try {
    const corners = (input.get('ForcePlates/0/Corners') as h5.Dataset).value as Float64Array;
    const data = parseH5Tree(input, 'moving.h5'),
      p = data.forcePlatforms[0];
    expect(data.forcePlatforms).toHaveLength(1);
    expect(data.warnings).toEqual([]);
    expect(p.corners!.values.length).toBe(36);
    expect(p.corners!.rate).toBe(100);
    expect(p.rotation!.rate).toBe(100);
    expect(p.position!.rate).toBe(100);
    expect(p.force.rate).toBe(200);
    expect(p.origin).toEqual(new Float64Array([0, 0, -0.05]));
    for (let f = 0; f < 3; f++)
      for (let j = 0; j < 4; j++)
        for (let a = 0; a < 3; a++)
          expect(sample(p.corners!, f / 100, j * 3 + a, true)).toBeCloseTo(
            corners[(a * 4 + j) * 3 + f] * 0.001,
            12,
          );
    expect(sample(p.corners!, 0.005, 0, true)).toBeCloseTo((corners[0] + corners[1]) * 0.0005, 12);
    const cropped = cropMotionData(data, 1, 3);
    const output = createH5Output(h5, input, resolve('.local/moving-plates-cropped.h5'));
    try {
      writeCroppedH5(h5, input, output, 1, 3);
      const reopened = parseH5Tree(output, 'cropped.h5').forcePlatforms[0];
      for (const field of ['corners', 'position', 'rotation', 'force'] as const)
        expect(reopened[field]!.values).toEqual(cropped.forcePlatforms[0][field]!.values);
      expect(reopened.origin).toEqual(p.origin);
      expect((output.get('ForcePlates/0/Corners') as h5.Dataset).shape).toEqual([3, 4, 2]);
      expect((output.get('ForcePlates/0/Force') as h5.Dataset).shape).toEqual([3, 4]);
    } finally {
      output.close();
    }
  } finally {
    input.close();
  }
});

it('retains visible corners with static 3x3 Rotation and vector Position', async () => {
  await h5.ready;
  const input = new h5.File(resolve('.local/moving-plates.h5'), 'r');
  try {
    const plate = input.get('ForcePlates/0') as h5.Group;
    const root = {
      get: (path: string) =>
        path === 'ForcePlates'
          ? {
              keys: () => ['0'],
              get: () => ({
                attrs: plate.attrs,
                get: (key: string) =>
                  key === 'Rotation'
                    ? { shape: [3, 3], value: new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]) }
                    : key === 'Position'
                      ? { shape: [3], value: new Float64Array([2000, 0, 50]) }
                      : plate.get(key),
              }),
            }
          : input.get(path),
    };
    const data = parseH5Tree(root, 'static-pose.h5');
    expect(data.forcePlatforms).toHaveLength(1);
    expect(data.warnings).toEqual([]);
    expect(data.forcePlatforms[0].rotation!.values.length).toBe(9);
    expect(data.forcePlatforms[0].position!.values).toEqual(new Float64Array([2, 0, 0.05]));
    expect(data.forcePlatforms[0].corners!.values.length).toBe(36);
  } finally {
    input.close();
  }
});
