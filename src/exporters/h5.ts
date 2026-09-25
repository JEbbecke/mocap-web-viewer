import type * as H5 from 'h5wasm';
import { parseH5Tree } from '../importers/h5/schema';
import { cropInterval, sampleBoundary, timeBoundary, eventInInterval } from '../motion/crop';
import type { MotionData, MotionEvent } from '../motion/types';
import { validateEvent } from '../motion/events';
import booleanSeeds from './h5-boolean-seeds.json';

type Library = typeof H5;
type Writable = Parameters<H5.Group['create_dataset']>[0]['data'];

/** Start a fresh output with only the boolean types present in this source.
 * Empty, synthetic templates work around h5wasm's missing enum constructor.
 * They contain no trial values; the entire source hierarchy is copied below. */
export function createH5Output(h5: Library, input: H5.File, path: string): H5.File {
  if (path === input.filename) throw new Error('H5 output must differ from the read-only source.');
  const flags = ['CameraMasks', 'CameraMasksKnown', 'Virtual'];
  let bits = 0;
  flags.forEach((key, i) => {
    const dataset = input.get(`Trajectories/Labeled/${key}`);
    if (dataset instanceof h5.Dataset && dataset.metadata.type === 8) {
      const m = dataset.metadata,
        members = m.enum_type?.members;
      if (
        !m.signed ||
        m.size !== 1 ||
        !members ||
        Object.keys(members).length !== 2 ||
        members.FALSE !== 0 ||
        members.TRUE !== 1 ||
        dataset.shape?.length !== (i === 0 ? 3 : 1)
      )
        throw new Error(`${dataset.path}: unsupported boolean enum layout.`);
      bits |= 1 << i;
    }
  });
  if (!bits) return new h5.File(path, 'w');
  const encoded = booleanSeeds[String(bits) as keyof typeof booleanSeeds];
  h5.Module.FS.writeFile(
    path,
    Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)),
  );
  return new h5.File(path, 'a');
}

/** Copy the institute hierarchy, slicing raw datasets before any unit normalization. */
export function writeCroppedH5(
  h5: Library,
  input: H5.File,
  output: H5.File,
  start: number,
  end: number,
  events?: MotionEvent[],
  sourceMotion?: MotionData,
) {
  const motion = sourceMotion ?? parseH5Tree(input, 'source.h5');
  const time = cropInterval(motion, start, end);
  const frames = motion.timeline.frameCount;
  const cropping = start !== 0 || end !== frames;
  const origin = motion.source.timeOrigin ?? 0;
  const eventRows =
    events ??
    motion.events
      .filter((e) => !cropping || eventInInterval(e.time, time.start, time.end, origin))
      .map((e) => ({ ...e, time: e.time - time.start }));
  if (events) {
    const editedMotion = { ...motion, timeline: { ...motion.timeline, frameCount: end - start } };
    for (const event of events) {
      const old = event.sourceIndex === undefined ? undefined : motion.events[event.sourceIndex];
      const unchanged =
        old &&
        old.label === event.label &&
        old.description === event.description &&
        old.context === event.context &&
        old.subject === event.subject &&
        Math.abs(old.time - event.time - time.start) < 1e-12;
      if (!unchanged) validateEvent(editedMotion, event);
    }
  }
  const scalar = (group: H5.Group, name: string) => {
    const value = group.attrs[name]?.value;
    return Number(
      ArrayBuffer.isView(value) || Array.isArray(value) ? (value as ArrayLike<unknown>)[0] : value,
    );
  };
  const slices = new Map<string, { axis: number; start: number; end: number }>();
  const clocks = new Map<string, Float64Array>();
  const updates = new Map<string, Record<string, number>>();
  if (cropping)
    updates.set('/Trajectories', {
      NumFrames: end - start,
      StartFrame: motion.timeline.firstFrame + start,
      EndFrame: motion.timeline.firstFrame + end - 1,
    });
  const slice = (ds: H5.Dataset, axis: number, rate: number, streamClock?: H5.Dataset | null) => {
    if (!cropping) return ds.shape![axis];
    const clock = streamClock === undefined ? ds.parent.get('Time') : streamClock;
    if (clock instanceof h5.Dataset) {
      let timestamps = clocks.get(clock.path);
      if (!timestamps) {
        timestamps = clock.value as Float64Array;
        clocks.set(clock.path, timestamps);
      }
      if (clock.shape?.length !== 1 || timestamps.length !== ds.shape![axis])
        throw new Error(`${ds.path}: Time sample count mismatch.`);
      const a = timeBoundary(timestamps, origin + time.start),
        b = timeBoundary(timestamps, origin + time.end);
      slices.set(ds.path, { axis, start: a, end: b });
      return b - a;
    }
    if (!Number.isFinite(rate) || rate <= 0) throw new Error(`${ds.path}: missing sampling rate.`);
    const a = sampleBoundary(time.start, rate),
      b = sampleBoundary(time.end, rate);
    // Legacy streams without Time cannot express a fractional time origin.
    if (Math.abs(time.start * rate - a) > 1e-7 || Math.abs(time.end * rate - b) > 1e-7)
      throw new Error(`${ds.path}: crop boundaries must align with this stream's sampling grid.`);
    const n = ds.shape![axis];
    const from = Math.min(n, a),
      to = Math.min(n, b);
    if (from === to) throw new Error(`${ds.path}: crop contains no samples.`);
    slices.set(ds.path, { axis, start: from, end: to });
    return to - from;
  };
  const primitive = (dtype: H5.Dataset['dtype'], path: string) => {
    if (typeof dtype !== 'string' || !/^(?:[<>|]?[bhiqefdBHIQ]|S\d*|A\d*)$/.test(dtype))
      throw new Error(`${path}: unsupported H5 data type; export stopped to avoid metadata loss.`);
    // h5wasm writes little-endian values; byte order is not a scientific value.
    return dtype.replace(/^>/, '<');
  };
  const copyAttrs = (source: H5.Group | H5.Dataset, target: H5.Group | H5.Dataset) => {
    const changes = updates.get(source.path) ?? {};
    for (const [name, attr] of Object.entries(source.attrs)) {
      const dtype = primitive(attr.dtype, `${source.path}@${name}`);
      const value = changes[name] ?? attr.value;
      if (value === null)
        throw new Error(`${source.path}@${name}: null attributes are unsupported.`);
      target.create_attribute(name, value as Writable, attr.shape, dtype);
    }
    for (const [name, value] of Object.entries(changes))
      if (!(name in source.attrs)) target.create_attribute(name, value);
  };
  const classify = (ds: H5.Dataset) => {
    const path = ds.path,
      shape = ds.shape;
    if (!shape) throw new Error(`${path}: null dataspaces are unsupported.`);
    if (!cropping) return;
    if (shape.includes(0)) return;
    if (path.startsWith('/MetaData/')) return;
    if (/^\/Trajectories\/(Labeled|Unlabeled)\/(Virtual|CameraMasksKnown)$/.test(path)) return;
    if (
      /^\/Trajectories\/(Labeled|Unlabeled)\/(Data|Type|Residuals|CameraMasks|Time)$/.test(path)
    ) {
      if (shape.at(-1) !== frames) throw new Error(`${path}: inconsistent trajectory timing.`);
      slice(ds, shape.length - 1, motion.timeline.rate);
      return;
    }
    if (/^\/(Analog|EMG|IKResults|IDResults)\/(Data|Time)$/.test(path)) {
      const n = slice(ds, shape.length - 1, scalar(ds.parent, 'SamplingFrequency'))!;
      updates.set(ds.parent.path, { NumSamples: n });
      return;
    }
    if (/^\/RigidBodies\/[^/]+\/Markers$/.test(path)) return;
    if (/^\/RigidBodies\/[^/]+\/(Position|Rotation)$/.test(path)) {
      if (shape.at(-1) !== frames) throw new Error(`${path}: cannot establish rigid body timing.`);
      slice(ds, shape.length - 1, motion.timeline.rate);
      updates.set(ds.parent.path, { NumSamples: end - start });
      return;
    }
    if (path.startsWith('/Events/') && motion.source.eventSchema) {
      if (shape.length !== 1 || shape[0] !== motion.events.length)
        throw new Error(`${path}: unsupported event row layout.`);
      return;
    }
    if (/^\/ForcePlates\/[^/]+\//.test(path)) {
      const name = path.split('/').at(-1)!;
      const plate = ds.parent;
      const rate = scalar(plate, 'SamplingFrequency');
      const force = plate.get('Force');
      if (!(force instanceof h5.Dataset) || force.shape?.length !== 2)
        throw new Error(`${path}: unknown force layout.`);
      const forceCount = force.shape[0] === 3 ? force.shape[1] : force.shape[0];
      if (['Force', 'Moment', 'COP'].includes(name)) {
        if (shape.length !== 2 || (shape[0] !== 3 && shape[1] !== 3))
          throw new Error(`${path}: unknown vector layout.`);
        if ((shape[0] === 3 ? shape[1] : shape[0]) !== forceCount)
          throw new Error(`${path}: inconsistent force/moment/COP sample counts.`);
        const n = slice(ds, shape[0] === 3 ? 1 : 0, rate)!;
        if (name === 'Force') updates.set(plate.path, { NumSamples: n });
        return;
      }
      if (name === 'Time' || name === 'Tz') {
        slice(ds, shape.length === 2 && shape[0] === 3 ? 1 : 0, rate);
        return;
      }
      if (name === 'Origin' && ['3', '3,1'].includes(shape.join(','))) return;
      if (name === 'Offset' && shape.join(',') === '3') return;
      if (['Corners', 'Location', 'Position', 'Rotation'].includes(name)) {
        const rank = name === 'Position' ? 2 : 3;
        if (shape.length === rank - 1) return;
        if (shape.length !== rank) throw new Error(`${path}: unknown geometry layout.`);
        const n = shape.at(-1)!;
        if (n === 1) return;
        const values = ds.value as ArrayLike<number>;
        let repeated = true;
        for (let i = 0; i < values.length && repeated; i++)
          repeated = Object.is(values[i], values[Math.floor(i / n) * n]);
        // Legacy converter's all-zero [3,3,3] Rotation is a static placeholder.
        if (
          name === 'Rotation' &&
          shape.join(',') === '3,3,3' &&
          Array.from(values).every((v) => v === 0)
        )
          return;
        if (n === forceCount) {
          slice(ds, rank - 1, rate);
          return;
        }
        if (n === frames) {
          const pointClock = input.get('Trajectories/Labeled/Time');
          slice(
            ds,
            rank - 1,
            motion.timeline.rate,
            pointClock instanceof h5.Dataset ? pointClock : null,
          );
          return;
        }
        if (repeated) return;
        throw new Error(`${path}: unknown dynamic geometry sampling rate.`);
      }
    }
    throw new Error(`${path}: timing is undocumented; cannot safely crop this dataset.`);
  };
  // Classify before writing: group attribute updates depend on child dataset extents.
  const inspect = (group: H5.Group, depth = 0) => {
    if (depth > 32) throw new Error('H5 hierarchy is too deep or contains cyclic links.');
    if (
      cropping &&
      group.path === '/Events' &&
      !motion.source.eventSchema &&
      (group.keys().length || Object.keys(group.attrs).length)
    )
      throw new Error(
        'Nonempty H5 Events has no established timing schema; export is unavailable.',
      );
    if (cropping && !group.path.startsWith('/MetaData')) {
      for (const name of Object.keys(group.attrs))
        if (/^(StartTime|TimeOffset|Timestamps?|TimeOrigin)$/i.test(name))
          throw new Error(
            `${group.path}@${name}: explicit timing is not part of the established H5 schema.`,
          );
    }
    for (const name of group.keys()) {
      const entity = group.get(name);
      if (entity instanceof h5.Group) inspect(entity, depth + 1);
      else if (entity instanceof h5.Dataset) classify(entity);
      else throw new Error(`${group.path}/${name}: H5 links and named types are unsupported.`);
    }
  };
  inspect(input);
  const copy = (source: H5.Group, target: H5.Group) => {
    copyAttrs(source, target);
    for (const name of source.keys()) {
      const entity = source.get(name)!;
      if (entity instanceof h5.Group)
        copy(entity, (target.get(name) as H5.Group | null) ?? target.create_group(name));
      else if (entity instanceof h5.Dataset) {
        const shape = [...entity.shape!];
        const selection = slices.get(entity.path);
        let data;
        if (selection) {
          const ranges: [number, number][] = shape.map((n) => [0, n]);
          ranges[selection.axis] = [selection.start, selection.end];
          data = entity.slice(ranges);
          shape[selection.axis] = selection.end - selection.start;
        } else data = entity.value;
        if (data === null) throw new Error(`${entity.path}: unreadable dataset.`);
        if (
          entity.path.startsWith('/Events/') &&
          motion.source.eventSchema &&
          (cropping || events)
        ) {
          if (shape.length !== 1 || shape[0] !== motion.events.length)
            throw new Error(`${entity.path}: unsupported event row layout.`);
          const original = data as ArrayLike<unknown>;
          const key = entity.path.split('/').at(-1)!;
          const values = eventRows.map((e) => {
            const old = e.sourceIndex === undefined ? undefined : motion.events[e.sourceIndex];
            if (e.sourceIndex !== undefined && !old)
              throw new Error('Events: original row identity is invalid.');
            const sameTime = old && Math.abs(old.time - (e.time + time.start)) < 1e-12;
            if (key === 'Name') return e.label;
            if (key === 'Description') return e.description ?? '';
            if (key === 'Time')
              return sameTime ? original[e.sourceIndex!] : origin + time.start + e.time;
            if (key === 'Frame')
              return sameTime
                ? original[e.sourceIndex!]
                : Math.round(motion.timeline.firstFrame + start + e.time * motion.timeline.rate);
            if (e.sourceIndex === undefined)
              throw new Error(`${entity.path}: cannot invent metadata for a new event.`);
            return original[e.sourceIndex];
          });
          data =
            data instanceof BigInt64Array
              ? BigInt64Array.from(values as (number | bigint)[], BigInt)
              : data instanceof BigUint64Array
                ? BigUint64Array.from(values as (number | bigint)[], BigInt)
                : ArrayBuffer.isView(data)
                  ? new (data.constructor as typeof Float64Array)(values as number[])
                  : (values as string[]);
          shape[0] = eventRows.length;
        }
        // [samples,3] becomes ambiguous when cropped to exactly three samples.
        // Write that case as [3,samples], the institute reader's preferred layout.
        if (
          selection?.axis === 0 &&
          shape.join(',') === '3,3' &&
          /^\/ForcePlates\/[^/]+\/(Force|Moment|COP|Tz)$/.test(entity.path)
        ) {
          const values = data as Float64Array;
          const transposed = values.slice();
          for (let sample = 0; sample < 3; sample++)
            for (let axis = 0; axis < 3; axis++)
              transposed[axis * 3 + sample] = values[sample * 3 + axis];
          data = transposed;
        }
        const ds = copyDataset(h5, entity, target, name, data as Writable, shape, primitive);
        copyAttrs(entity, ds);
      }
    }
  };
  copy(input, output);
  output.flush();
}

/** Write directly into a seeded boolean dataset using its native enum type. */
function copyDataset(
  h5: Library,
  source: H5.Dataset,
  target: H5.Group,
  name: string,
  data: Writable,
  shape: number[],
  primitive: (dtype: H5.Dataset['dtype'], path: string) => string,
) {
  const meta = source.metadata;
  const chunks = meta.chunks?.map((n, i) => Math.max(1, Math.min(n, shape[i] || 1)));
  const gzip = source.filters.find((f) => f.id === 1);
  if (meta.type === 8 && ArrayBuffer.isView(data)) {
    const dataset = target.get(name);
    if (
      !(dataset instanceof h5.Dataset) ||
      JSON.stringify(dataset.metadata.enum_type) !== JSON.stringify(meta.enum_type) ||
      dataset.metadata.size !== meta.size ||
      dataset.metadata.signed !== meta.signed
    )
      throw new Error(
        `${source.path}: enum cannot be recreated; export stopped to avoid type loss.`,
      );
    if (dataset.resize(shape) < 0)
      throw new Error(`${source.path}: cannot resize boolean dataset.`);
    if (data.byteLength) {
      const ptr = h5.Module._malloc(data.byteLength);
      if (!ptr) throw new Error('Insufficient memory for H5 boolean export.');
      try {
        h5.Module.HEAPU8.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), ptr);
        if (
          h5.Module.set_dataset_data(dataset.file_id, dataset.path, null, null, null, BigInt(ptr)) <
          0
        )
          throw new Error(`${source.path}: cannot write boolean dataset.`);
      } finally {
        h5.Module._free(ptr);
      }
    }
    return dataset;
  }
  return target.create_dataset({
    name,
    data,
    shape,
    dtype: primitive(source.dtype, source.path),
    ...(chunks
      ? {
          chunks,
          ...(gzip && !meta.vlen
            ? { compression: 'gzip' as const, compression_opts: gzip.cd_values }
            : {}),
        }
      : {}),
  });
}

export async function exportH5(
  file: File,
  start: number,
  end: number,
  events?: MotionEvent[],
): Promise<ArrayBuffer> {
  const h5 = await import('h5wasm');
  const { FS } = await h5.ready;
  FS.mkdir('/source');
  FS.mount(FS.filesystems.WORKERFS, { blobs: [{ name: 'input.h5', data: file }] }, '/source');
  let input: H5.File | undefined, output: H5.File | undefined;
  try {
    input = new h5.File('/source/input.h5', 'r');
    const motion = parseH5Tree(input, file.name);
    cropInterval(motion, start, end);
    if (start === 0 && end === motion.timeline.frameCount && events === undefined)
      return await file.arrayBuffer();
    output = createH5Output(h5, input, '/output.h5');
    writeCroppedH5(h5, input, output, start, end, events, motion);
    output.close();
    output = undefined;
    return (FS.readFile('/output.h5') as Uint8Array).slice().buffer;
  } finally {
    output?.close();
    input?.close();
    if (FS.analyzePath('/output.h5').exists) FS.unlink('/output.h5');
    FS.unmount('/source');
    FS.rmdir('/source');
  }
}
