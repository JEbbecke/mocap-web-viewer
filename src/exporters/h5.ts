import type * as H5 from 'h5wasm';
import { parseH5Tree } from '../importers/h5/schema';
import { cropInterval, sampleBoundary } from '../motion/crop';

type Library = typeof H5;
type Writable = Parameters<H5.Group['create_dataset']>[0]['data'];

/** Copy the institute hierarchy, slicing raw datasets before any unit normalization. */
export function writeCroppedH5(
  h5: Library,
  input: H5.File,
  output: H5.File,
  start: number,
  end: number,
) {
  const motion = parseH5Tree(input, 'source.h5');
  const time = cropInterval(motion, start, end);
  const frames = motion.timeline.frameCount;
  const scalar = (group: H5.Group, name: string) => {
    const value = group.attrs[name]?.value;
    return Number(
      ArrayBuffer.isView(value) || Array.isArray(value) ? (value as ArrayLike<unknown>)[0] : value,
    );
  };
  const slices = new Map<string, { axis: number; start: number; end: number }>();
  const updates = new Map<string, Record<string, number>>();
  updates.set('/Trajectories', {
    NumFrames: end - start,
    StartFrame: motion.timeline.firstFrame + start,
    EndFrame: motion.timeline.firstFrame + end - 1,
  });
  const slice = (ds: H5.Dataset, axis: number, rate: number) => {
    if (!Number.isFinite(rate) || rate <= 0) throw new Error(`${ds.path}: missing sampling rate.`);
    const a = sampleBoundary(time.start, rate),
      b = sampleBoundary(time.end, rate);
    // The established schema has no per-stream time origin. Do not silently shift samples.
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
      // Temporal counts can outgrow a narrow source dtype; store them as exact doubles.
      target.create_attribute(name, value as Writable, attr.shape, name in changes ? '<d' : dtype);
    }
    for (const [name, value] of Object.entries(changes))
      if (!(name in source.attrs)) target.create_attribute(name, value);
  };
  const classify = (ds: H5.Dataset) => {
    const path = ds.path,
      shape = ds.shape;
    if (!shape) throw new Error(`${path}: null dataspaces are unsupported.`);
    if (shape.includes(0)) return;
    if (path.startsWith('/MetaData/')) return;
    if (/^\/Trajectories\/(Labeled|Unlabeled)\/(Data|Type|Residuals)$/.test(path)) {
      if (shape.at(-1) !== frames) throw new Error(`${path}: inconsistent trajectory timing.`);
      slice(ds, shape.length - 1, motion.timeline.rate);
      return;
    }
    if (path === '/Analog/Data' && shape.length === 2) {
      const n = slice(ds, 1, scalar(ds.parent, 'SamplingFrequency'))!;
      updates.set('/Analog', { NumSamples: n });
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
      if (name === 'Tz' && shape.length === 1) {
        slice(ds, 0, rate);
        return;
      }
      if (name === 'Offset' && shape.join(',') === '3') return;
      if (['Location', 'Position', 'Rotation'].includes(name)) {
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
        if (n === frames) {
          slice(ds, rank - 1, motion.timeline.rate);
          return;
        }
        if (n === forceCount) {
          slice(ds, rank - 1, rate);
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
    if (group.path === '/Events' && (group.keys().length || Object.keys(group.attrs).length))
      throw new Error(
        'Nonempty H5 Events has no established timing schema; export is unavailable.',
      );
    if (!group.path.startsWith('/MetaData')) {
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
      if (entity instanceof h5.Group) copy(entity, target.create_group(name));
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
        // [samples,3] becomes ambiguous when cropped to exactly three samples.
        // Write that case as [3,samples], the institute reader's preferred layout.
        if (
          selection?.axis === 0 &&
          shape.join(',') === '3,3' &&
          /^\/ForcePlates\/[^/]+\/(Force|Moment|COP)$/.test(entity.path)
        ) {
          const values = data as Float64Array;
          const transposed = values.slice();
          for (let sample = 0; sample < 3; sample++)
            for (let axis = 0; axis < 3; axis++)
              transposed[axis * 3 + sample] = values[sample * 3 + axis];
          data = transposed;
        }
        const ds = target.create_dataset({
          name,
          data: data as Writable,
          shape,
          dtype: primitive(entity.dtype, entity.path),
        });
        copyAttrs(entity, ds);
      }
    }
  };
  copy(input, output);
  output.flush();
}

export async function exportH5(file: File, start: number, end: number): Promise<ArrayBuffer> {
  const h5 = await import('h5wasm');
  const { FS } = await h5.ready;
  FS.mkdir('/source');
  FS.mount(FS.filesystems.WORKERFS, { blobs: [{ name: 'input.h5', data: file }] }, '/source');
  let input: H5.File | undefined, output: H5.File | undefined;
  try {
    input = new h5.File('/source/input.h5', 'r');
    const motion = parseH5Tree(input, file.name);
    cropInterval(motion, start, end);
    if (start === 0 && end === motion.timeline.frameCount) return await file.arrayBuffer();
    output = new h5.File('/output.h5', 'w');
    writeCroppedH5(h5, input, output, start, end);
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
