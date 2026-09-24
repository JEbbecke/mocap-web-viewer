import type { MotionData } from './types';
export function makeDemo(): MotionData {
  const labels = [
    'LASI',
    'RASI',
    'LPSI',
    'RPSI',
    'LKNE',
    'RKNE',
    'LANK',
    'RANK',
    'LHEE',
    'RHEE',
    'LTOE',
    'RTOE',
    'LSHO',
    'RSHO',
    'LELB',
    'RELB',
    'LWRA',
    'RWRA',
  ];
  const frames = 360,
    rate = 120,
    positions = new Float32Array(frames * labels.length * 3),
    valid = new Uint8Array(frames * labels.length).fill(1);
  for (let f = 0; f < frames; f++)
    for (let m = 0; m < labels.length; m++) {
      const left = labels[m][0] === 'L',
        side = left ? -1 : 1,
        phase = (f / rate) * Math.PI * 2 + (left ? 0 : Math.PI),
        part = labels[m].slice(1);
      const z = (
        {
          ASI: 1,
          PSI: 1,
          KNE: 0.56,
          ANK: 0.1,
          HEE: 0.055,
          TOE: 0.04,
          SHO: 1.52,
          ELB: 1.22,
          WRA: 0.97,
        } as Record<string, number>
      )[part];
      const lower = ['KNE', 'ANK', 'HEE', 'TOE'].includes(part),
        arm = ['ELB', 'WRA'].includes(part);
      const x = lower ? 0.22 * Math.sin(phase) : arm ? -0.17 * Math.sin(phase) : 0;
      positions.set(
        [
          x + (part === 'TOE' ? 0.18 : part === 'PSI' ? -0.1 : 0),
          side * (part === 'SHO' ? 0.23 : arm ? 0.28 : 0.12),
          z + (lower ? Math.max(0, Math.cos(phase)) * 0.08 : 0.015 * Math.cos(phase * 2)),
        ],
        (f * labels.length + m) * 3,
      );
    }
  const force = new Float64Array(frames * 3),
    cop = new Float64Array(frames * 3),
    moment = new Float64Array(frames * 3);
  for (let f = 0; f < frames; f++) {
    force[f * 3 + 2] = 450 + 180 * Math.sin((f / rate) * Math.PI * 2);
    cop[f * 3] = 0.1 * Math.sin((f / rate) * Math.PI * 2);
  }
  const series = (values: Float64Array, components = 3) => ({
    values,
    components,
    rate,
    startTime: 0,
  });
  return {
    name: 'Synthetic walking demo',
    source: {
      format: 'DEMO',
      originalPositionUnit: 'm',
      metadata: { description: 'Illustrative generated motion; not a recorded or clinical trial.' },
    },
    timeline: { frameCount: frames, rate, firstFrame: 0, duration: (frames - 1) / rate },
    markers: { labels, positions, valid },
    analogs: [],
    forcePlatforms: [
      {
        name: 'Demo plate',
        force: series(force),
        moment: series(moment),
        cop: series(cop),
        corners: series(
          new Float64Array([0.5, 0.4, 0, -0.5, 0.4, 0, -0.5, -0.4, 0, 0.5, -0.4, 0]),
          12,
        ),
        coordinateFrame: 'global',
        provenance: 'Synthetic',
      },
    ],
    events: [{ label: 'Demo event', context: 'Synthetic', time: 1 }],
    warnings: ['Synthetic motion for exploring the interface; not measurement data.'],
  };
}
