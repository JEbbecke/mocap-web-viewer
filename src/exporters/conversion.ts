import type { ForcePlatform, MotionData, Series, Vec3 } from '../motion/types';
import { add, cross, mul, plateBasis, rotate, sub, uniqueLabels } from '../motion/math';

export type ExportFormat = 'C3D' | 'H5';
export interface ConversionReport {
  target: ExportFormat;
  sameFormat: boolean;
  included: string[];
  warnings: string[];
  errors: string[];
}
export interface ConvertedPlate {
  index: number;
  basis: Vec3[];
  center: Vec3;
  warnings: string[];
}
export interface ConversionPlan {
  report: ConversionReport;
  analogs: MotionData['analogs'];
  analogRate: number;
  plates: ConvertedPlate[];
  residualStep: number;
}

/** A C3D grid is regular, starts with the first point and contains every subframe.
 * This verifies stored timestamps; it never interpolates, pads or resamples. */
export function c3dGridIssue(s: Series, frames: number, pointRate: number): string | undefined {
  if (!Number.isFinite(s.rate) || s.rate <= 0 || Math.fround(s.rate) !== s.rate)
    return 'sampling rate is not exactly representable in C3D float32 metadata';
  const ratio = s.rate / pointRate;
  if (!Number.isSafeInteger(ratio) || ratio < 1)
    return 'sampling rate is not a positive integer multiple of the point rate';
  const count = s.values.length / s.components;
  if (count !== frames * ratio) return 'sample count does not cover all point/analog subframes';
  if (s.times && s.times.length !== count) return 'timestamp count differs from sample count';
  for (let i = 0; i < count; i++) {
    const t = s.times?.[i] ?? s.startTime + i / s.rate;
    if (!Number.isFinite(t) || Math.abs(t - i / s.rate) > 1e-8)
      return 'timestamps are offset or irregular relative to the point recording';
  }
}

export const inPlateFrame = (basis: Vec3[], vector: Vec3): Vec3 =>
  basis.map((axis) => axis.reduce((sum, x, i) => sum + x * vector[i], 0)) as Vec3;
const vectorAt = (s: Series, i: number): Vec3 =>
  Array.from(s.values.subarray(i * 3, i * 3 + 3)) as Vec3;
const near = (a: number, b: number, tolerance = 1e-6) =>
  (Number.isNaN(a) && Number.isNaN(b)) ||
  (Number.isFinite(a) &&
    Number.isFinite(b) &&
    Math.abs(a - b) <= tolerance + 1e-7 * Math.max(Math.abs(a), Math.abs(b)));

/** Export policy for surveyed corners, not tolerances prescribed by C3D. */
const cornerLimits = {
  angleDegrees: 1,
  midpointFraction: 0.01,
  midpointMm: 5,
  planeFraction: 0.005,
  planeMm: 2,
};

function assessCorners(corners: Vec3[], basis: Vec3[], center: Vec3): string | undefined {
  if (corners.some((c) => c.some((v) => !Number.isFinite(v))))
    throw new Error('corners contain nonfinite coordinates');
  const local = corners.map((c) => inPlateFrame(basis, sub(c, center)));
  // Required quadrant order (+x,+y), (-x,+y), (-x,-y), (+x,-y).
  const signs = [
    [1, 1],
    [-1, 1],
    [-1, -1],
    [1, -1],
  ];
  if (local.some((c, i) => signs[i].some((s, axis) => c[axis] * s <= 0)))
    throw new Error('corners do not follow the C3D quadrant order');
  let shortest = Infinity,
    maxAngle = 0;
  for (let i = 0; i < 4; i++) {
    const a = sub(corners[(i + 1) % 4], corners[i]);
    const b = sub(corners[(i + 3) % 4], corners[i]);
    const length = Math.hypot(...a),
      otherLength = Math.hypot(...b);
    if (length < 1e-6 || otherLength < 1e-6) throw new Error('degenerate force-platform edges');
    shortest = Math.min(shortest, length);
    const next = sub(local[(i + 2) % 4], local[(i + 1) % 4]);
    const edge = sub(local[(i + 1) % 4], local[i]);
    if (edge[0] * next[1] - edge[1] * next[0] <= 0)
      throw new Error('corners define a crossed or nonconvex surface');
    const cosine = a.reduce((sum, v, axis) => sum + v * b[axis], 0) / (length * otherLength);
    const angle = (Math.acos(Math.max(-1, Math.min(1, cosine))) * 180) / Math.PI;
    maxAngle = Math.max(maxAngle, Math.abs(angle - 90));
  }
  const midpoint = Math.hypot(
    ...mul(sub(add(corners[0], corners[2]), add(corners[1], corners[3])), 0.5),
  );
  // Distance of corner 3 from the plane through corners 0,1,3. Translation invariant.
  const plane = Math.abs(inPlateFrame(basis, sub(corners[2], corners[0]))[2]);
  const midpointLimit = Math.min(cornerLimits.midpointMm, shortest * cornerLimits.midpointFraction);
  const planeLimit = Math.min(cornerLimits.planeMm, shortest * cornerLimits.planeFraction);
  if (maxAngle > cornerLimits.angleDegrees || midpoint > midpointLimit || plane > planeLimit)
    throw new Error(
      `corner geometry exceeds export tolerances (angle error ${maxAngle.toFixed(3)}° / ${cornerLimits.angleDegrees}°, diagonal midpoints ${midpoint.toFixed(3)} / ${midpointLimit.toFixed(3)} mm, non-planarity ${plane.toFixed(3)} / ${planeLimit.toFixed(3)} mm)`,
    );
  if (maxAngle > 1e-5 || midpoint > 1e-4 || plane > 1e-4)
    return `measured corners deviate slightly from a rectangle (maximum angle error ${maxAngle.toFixed(3)}°, diagonal midpoints ${midpoint.toFixed(3)} mm apart, non-planarity ${plane.toFixed(3)} mm). Original corner order and coordinates are retained, subject to C3D float32 precision; plate axes are derived from the corner edges.`;
}

/** Stationary approximately rectangular plates export their surface-centre wrench. Readers
 * reconstruct COP/free moment; incompatible stored derived values are reported. */
function preparePlate(
  p: ForcePlatform,
  index: number,
  data: MotionData,
  rate: number,
): ConvertedPlate {
  if (!p.name || new TextEncoder().encode(p.name).length > 255 || p.name.includes('\0'))
    throw new Error('plate name cannot be represented in C3D');
  if (p.coordinateFrame !== 'global') throw new Error('coordinate frame is unresolved');
  if (!p.corners || p.corners.components !== 12 || p.corners.values.length !== 12)
    throw new Error('stationary four-corner geometry is required (moving plates are not exported)');
  const corners = Array.from(
    { length: 4 },
    (_, i) => Array.from(p.corners!.values.subarray(i * 3, i * 3 + 3)) as Vec3,
  );
  const basis = plateBasis(corners);
  const center = mul(
    corners.reduce((sum, c) => add(sum, c), [0, 0, 0] as Vec3),
    0.25,
  );
  const roundedCorners = corners.map((c) => c.map(Math.fround) as Vec3);
  const roundedBasis = plateBasis(roundedCorners);
  const roundedCenter = mul(
    roundedCorners.reduce((sum, c) => add(sum, c), [0, 0, 0] as Vec3),
    0.25,
  );
  for (const pose of [p.position, p.rotation])
    if (pose && pose.values.some((v, i) => !near(v, pose.values[i % pose.components])))
      throw new Error('moving position/orientation has no stationary C3D plate mapping');
  const geometryWarning = assessCorners(corners, basis, center);
  // Encoded geometry must still meet ordering/shape limits after float32 storage.
  assessCorners(roundedCorners, roundedBasis, roundedCenter);
  for (const [name, s] of [
    ['force', p.force],
    ['moment', p.moment],
  ] as const) {
    const issue = c3dGridIssue(s, data.timeline.frameCount, data.timeline.rate);
    if (issue || s.rate !== rate)
      throw new Error(`${name}: ${issue ?? 'rate differs from the C3D analog grid'}`);
  }
  const derivedIssue = (s: Series, components: number[]) =>
    !components.includes(s.components)
      ? 'unsupported component count'
      : (c3dGridIssue(s, data.timeline.frameCount, data.timeline.rate) ??
        (s.rate !== rate ? 'rate differs from the C3D analog grid' : undefined));
  const copIssue = derivedIssue(p.cop, [3]);
  const freeIssue = p.freeMoment
    ? (derivedIssue(p.freeMoment, [1, 3]) ??
      (p.freeMoment.components === 1 && basis[2].some((v, axis) => !near(v, axis === 2 ? 1 : 0))
        ? 'scalar free-moment coordinate convention is unverified'
        : undefined))
    : undefined;
  let copDifferences = 0,
    maxCopDifference = 0,
    freeDiffers = false;
  for (let i = 0; i < p.force.values.length / 3; i++) {
    const f = inPlateFrame(basis, vectorAt(p.force, i));
    const m = inPlateFrame(basis, mul(vectorAt(p.moment, i), 1000));
    if (![...f, ...m].every((v) => Number.isFinite(v) && Number.isFinite(Math.fround(v))))
      throw new Error('wrench contains nonfinite values or exceeds float32 capacity');
    const localCop: Vec3 =
      Math.abs(f[2]) > 1e-12 ? [-m[1] / f[2], m[0] / f[2], 0] : [NaN, NaN, NaN];
    const expectedCop = add(center, rotate(basis, localCop));
    if (!copIssue && expectedCop.some((v, axis) => !near(v, p.cop.values[i * 3 + axis], 1e-4))) {
      copDifferences++;
      const difference = Math.hypot(
        ...expectedCop.map((v, axis) => v - p.cop.values[i * 3 + axis]),
      );
      if (Number.isFinite(difference)) maxCopDifference = Math.max(maxCopDifference, difference);
    }
    const roundedForce = f.map(Math.fround) as Vec3;
    const roundedMoment = m.map(Math.fround) as Vec3;
    const roundedCop: Vec3 =
      Math.abs(roundedForce[2]) > 1e-12
        ? [-roundedMoment[1] / roundedForce[2], roundedMoment[0] / roundedForce[2], 0]
        : [NaN, NaN, NaN];
    if (
      add(roundedCenter, rotate(roundedBasis, roundedCop)).some(
        (v, axis) => !near(v, expectedCop[axis], 1e-3),
      )
    )
      throw new Error('float32 geometry/wrench encoding cannot reconstruct COP reliably');
    if (p.freeMoment && !freeIssue) {
      const free = mul(rotate(basis, add(m, cross(f, localCop))), 0.001);
      if (p.freeMoment.components === 3) {
        if (free.some((v, axis) => !near(v, p.freeMoment!.values[i * 3 + axis])))
          freeDiffers = true;
      } else if (!near(free[2], p.freeMoment.values[i])) freeDiffers = true;
    }
  }
  const warnings: string[] = [];
  if (geometryWarning) warnings.push(`Force platform ${p.name}: ${geometryWarning}`);
  if (copIssue || copDifferences) {
    const difference = copIssue
      ? `cannot be compared on the force/moment grid (${copIssue})`
      : `is inconsistent with a surface-centre force/moment representation at ${copDifferences} samples${maxCopDifference ? ` (maximum finite difference ${maxCopDifference.toPrecision(4)} mm)` : ''}`;
    warnings.push(
      `Force platform ${p.name}: stored COP ${difference}. Stored COP is omitted from the exported C3D; readers reconstruct COP from the exported force and moment.`,
    );
  }
  if (p.freeMoment && (freeIssue || freeDiffers))
    warnings.push(
      `Force platform ${p.name}: stored free moment ${freeIssue ? `cannot be compared reliably (${freeIssue})` : 'differs from the force/moment-based reconstruction'}. Stored free moment is omitted from the exported C3D; readers reconstruct it using the reconstructed COP.`,
    );
  return { index, basis, center, warnings };
}

/** Pure preflight over current edited data. Numerical buffers stay referenced,
 * not copied, in this plan; the worker independently repeats the checks. */
export function conversionPlan(data: MotionData, target: ExportFormat): ConversionPlan {
  const report: ConversionReport = {
    target,
    sameFormat: target === data.source.format,
    included: [],
    warnings: [],
    errors: [],
  };
  const plan: ConversionPlan = {
    report,
    analogs: data.analogs,
    analogRate: 0,
    plates: [],
    residualStep: 0.001,
  };
  if (report.sameFormat) return plan;
  const { rate, frameCount, firstFrame } = data.timeline;
  const markerCount = data.markers.labels.length;
  if (
    !Number.isFinite(rate) ||
    rate <= 0 ||
    !Number.isSafeInteger(frameCount) ||
    frameCount < 1 ||
    !Number.isSafeInteger(firstFrame) ||
    markerCount < 1 ||
    data.markers.positions.length !== markerCount * frameCount * 3 ||
    data.markers.valid.length !== markerCount * frameCount ||
    (data.markers.residuals && data.markers.residuals.length !== markerCount * frameCount)
  )
    report.errors.push('Invalid point dimensions, rate or source-frame origin.');
  report.included.push(`${markerCount} markers in mm`, `${data.events.length} events`);
  if (data.events.some((e) => !Number.isFinite(e.time)))
    report.errors.push('An event has an invalid time.');
  report.warnings.push(
    'Source-specific parameters, unimported datasets and acquisition/calibration provenance are not copied. Use the source format to preserve them.',
  );
  if (data.warnings.length)
    report.warnings.push(
      'Existing import warnings still apply; uninterpreted source data cannot be converted.',
    );
  if (target === 'H5') {
    report.included.push(
      `${data.analogs.length} analog channels with their own clocks`,
      `${data.forcePlatforms.length} force platforms with global force, moment, COP and available geometry/free moment`,
    );
    if (data.forcePlatforms.some((p) => p.coordinateFrame !== 'global'))
      report.errors.push('H5 conversion requires known global force-platform coordinates.');
    if (data.source.info?.subject?.name)
      report.warnings.push(
        'Subject names have no established mapping to the institute H5 SubjectID field and are omitted.',
      );
    report.warnings.push(
      'The H5 trajectory fourth component is unspecified and written as NaN; residuals and validity use the separate Residuals dataset.',
    );
    return plan;
  }
  if (Math.fround(rate) !== rate)
    report.errors.push('Point rate is not exactly representable in C3D float32 metadata.');
  if (
    firstFrame < 0 ||
    firstFrame + frameCount > 0xffffffff ||
    markerCount > 65535 ||
    Math.fround(frameCount) !== frameCount
  )
    report.errors.push('Point counts or source frame range exceed the supported C3D fields.');
  const textIssue = (value: string) =>
    new TextEncoder().encode(value).length > 255 || value.includes('\0');
  if (data.markers.labels.some((v) => !v || textIssue(v)))
    report.errors.push('C3D marker labels require 1–255 UTF-8 bytes without null characters.');
  if (
    data.events.length > 255 ||
    data.events.some((e) =>
      [e.label, e.context, e.description ?? '', e.subject ?? ''].some(textIssue),
    )
  )
    report.errors.push(
      'C3D supports at most 255 events with at most 255 UTF-8 bytes per text field.',
    );
  if (
    data.events.some((e) =>
      [e.label, e.context, e.description ?? '', e.subject ?? ''].some((s) => s !== s.trim()),
    )
  )
    report.warnings.push(
      'C3D text readers can trim padding whitespace; leading/trailing event whitespace may not survive re-import.',
    );
  if (data.markers.positions.some((v) => Number.isFinite(v) && !Number.isFinite(Math.fround(v))))
    report.errors.push('Marker coordinates exceed C3D float32 capacity.');
  plan.analogs = [...data.analogs];
  plan.analogRate = data.analogs[0]?.signal.rate ?? 0;
  for (const channel of data.analogs) {
    const issue = c3dGridIssue(channel.signal, frameCount, rate);
    if (issue || channel.signal.components !== 1 || channel.signal.rate !== plan.analogRate)
      report.errors.push(
        `Analog ${channel.name}: ${issue ?? 'channels must share one scalar analog grid'}. No resampling is performed.`,
      );
  }
  const emg = data.signals?.filter((s) => s.group === 'EMG') ?? [];
  for (const channel of emg.filter((s) => s.analogIndex === undefined)) {
    const issue = c3dGridIssue(channel.signal, frameCount, rate);
    if (
      issue ||
      channel.signal.components !== 1 ||
      (plan.analogRate && channel.signal.rate !== plan.analogRate)
    )
      report.warnings.push(
        `EMG ${channel.name} omitted: ${issue ?? 'not on the C3D analog grid'}.`,
      );
    else {
      plan.analogRate ||= channel.signal.rate;
      plan.analogs.push({ name: channel.name, unit: channel.unit, signal: channel.signal });
    }
  }
  if (emg.length)
    report.warnings.push(
      'The H5 EMG grouping is omitted; compatible underlying scalar channels are retained as analogs.',
    );
  for (const [index, p] of data.forcePlatforms.entries()) {
    try {
      const plate = preparePlate(p, index, data, plan.analogRate || p.force.rate);
      plan.analogRate ||= p.force.rate;
      plan.plates.push(plate);
      report.warnings.push(...plate.warnings);
    } catch (error) {
      report.warnings.push(
        `Force platform ${p.name} omitted: ${error instanceof Error ? error.message : String(error)}.`,
      );
    }
  }
  const analogCount = plan.analogs.length + plan.plates.length * 6;
  if (
    analogCount > 255 ||
    (analogCount && (analogCount * plan.analogRate) / rate > 65535) ||
    plan.plates.length > 255
  )
    report.errors.push(
      'C3D analog or force-platform counts exceed the supported parameter/header capacity.',
    );
  if (
    plan.analogs.some(
      (a) =>
        !a.name ||
        textIssue(a.name) ||
        textIssue(a.unit) ||
        a.signal.values.some((v) => Number.isFinite(v) && !Number.isFinite(Math.fround(v))),
    )
  )
    report.errors.push('Analog names/units or numeric values exceed C3D storage capacity.');
  const names = uniqueLabels(plan.analogs.map((a) => a.name));
  if (names.some((n, i) => n !== plan.analogs[i].name))
    report.warnings.push('Colliding added EMG channel names receive unique suffixes.');
  plan.analogs = plan.analogs.map((a, i) => ({ ...a, name: names[i] }));
  if (plan.plates.length)
    report.warnings.push(
      `${plan.plates.length} force platforms use derived six-axis TYPE-2 channels with zero sensor offset; this is not the original hardware acquisition representation.`,
    );
  report.included.push(
    `${plan.analogs.length} analog/EMG channels`,
    `${plan.plates.length} derived force platforms (${plan.plates.length * 6} additional analog channels)`,
  );
  let maxResidual = 0;
  for (const v of data.markers.residuals ?? [])
    if (Number.isFinite(v) && v > maxResidual) maxResidual = v;
  plan.residualStep = Math.fround(Math.max(0.001, maxResidual / 254));
  if (!Number.isFinite(plan.residualStep))
    report.errors.push('Residual magnitudes exceed C3D scaling capacity.');
  report.warnings.push(
    `C3D uses float32 coordinates/samples and packed residuals (step ${plan.residualStep} mm); numerical precision can decrease.`,
  );
  if (
    !data.markers.residuals ||
    data.markers.residuals.some((r, i) => data.markers.valid[i] && !Number.isFinite(r))
  )
    report.warnings.push('Unknown residual magnitudes become zero; point validity is retained.');
  if (
    data.markers.quality &&
    [
      data.markers.quality.type,
      data.markers.quality.virtual,
      data.markers.quality.cameraMasks,
      data.markers.quality.cameraMasksKnown,
    ].some((v) => v?.length)
  )
    report.warnings.push('H5 Type, Virtual and camera-quality fields are omitted.');
  if (data.rigidBodies?.length)
    report.warnings.push(
      `${data.rigidBodies.length} rigid bodies omitted; no synthetic markers are created.`,
    );
  for (const kind of ['ik', 'id'] as const)
    if (data.source.info?.modelResults?.[kind])
      report.warnings.push(
        `${kind.toUpperCase()} results and processing metadata omitted; they are not point data.`,
      );
  if (
    data.source.info?.provenance ||
    data.source.info?.location ||
    data.source.info?.coordinateSystem
  )
    report.warnings.push(
      'Project/file/location metadata and coordinate-system descriptions have no established C3D mapping and are omitted; lab XYZ values remain unchanged.',
    );
  if (
    data.source.info?.subject?.group ||
    Object.values(data.source.info?.subject ?? {}).some(
      (v) =>
        v && (v.values.length !== 1 || v.values.some(textIssue) || (v.unit && textIssue(v.unit))),
    )
  )
    report.warnings.push(
      'Subject group, multi-valued demographics or overlong subject metadata have no supported C3D mapping and are omitted.',
    );
  if (data.events.some((e) => e.genericFlag || e.iconId || e.sourceFrame !== undefined))
    report.warnings.push(
      'H5 original event-frame provenance, icons and flags are omitted; current event times are preserved.',
    );
  if (
    data.source.timeOrigin !== undefined &&
    Math.abs(data.source.timeOrigin - firstFrame / rate) > 1e-8
  )
    report.warnings.push(
      'H5 absolute clock origin is replaced by the C3D source-frame origin; relative stream/event timing is preserved.',
    );
  return plan;
}

export function requireConversion(data: MotionData, target: ExportFormat): ConversionPlan {
  const plan = conversionPlan(data, target);
  if (plan.report.sameFormat)
    throw new Error('Use the source-preserving exporter for same-format output.');
  if (plan.report.errors.length) throw new Error(plan.report.errors.join(' '));
  return plan;
}
