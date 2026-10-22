/** Independent small encoder for the documented separate ROTATION block.
 * It deliberately puts distinctive analog samples between point frames. */
export function rotationFixture({
  analog = true,
  rotation = true,
  little = true,
  ratio = 2,
  unit = 'cm',
  declaredFrames,
  unknownEncoding = false,
  rotationGroupName = 'ROTATION',
}: {
  analog?: boolean;
  rotation?: boolean;
  little?: boolean;
  ratio?: number;
  unit?: string;
  declaredFrames?: number;
  unknownEncoding?: boolean;
  rotationGroupName?: string;
} = {}) {
  const frames = 3;
  const frameBytes = (2 * 4 + (analog ? 2 * 2 : 0)) * 4;
  const rotationStart = Math.ceil((2048 + frames * frameBytes) / 512) * 512;
  const bytes = new Uint8Array(rotation ? rotationStart + frames * ratio * 2 * 68 : rotationStart);
  const view = new DataView(bytes.buffer);
  bytes[0] = 2;
  bytes[1] = 80;
  view.setUint16(2, 2, little);
  view.setUint16(4, analog ? 4 : 0, little);
  view.setUint16(6, 37, little);
  view.setUint16(8, 39, little);
  view.setFloat32(12, -0.5, little);
  view.setUint16(16, 5, little);
  view.setUint16(18, analog ? 2 : 0, little);
  view.setFloat32(20, 100, little);
  bytes.set([0, 80, 3, little ? 84 : 86], 512);
  let pos = 516;
  const record = (id: number, name: string, payload: number[]) => {
    bytes[pos++] = name.length;
    view.setInt8(pos++, id);
    bytes.set(new TextEncoder().encode(name), pos);
    pos += name.length;
    view.setInt16(pos, payload.length + 2, little);
    pos += 2;
    bytes.set(payload, pos);
    pos += payload.length;
  };
  const group = (id: number, name: string) => record(-id, name, [0]);
  const param = (
    id: number,
    name: string,
    kind: number,
    dims: number[],
    values: string | number[],
  ) => {
    const raw = new Uint8Array(typeof values === 'string' ? values.length : values.length * kind);
    const data = new DataView(raw.buffer);
    if (typeof values === 'string') raw.set(new TextEncoder().encode(values));
    else
      values.forEach((value, i) =>
        kind === 4 ? data.setFloat32(i * 4, value, little) : data.setInt16(i * 2, value, little),
      );
    record(id, name, [kind & 255, dims.length, ...dims, ...raw, 0]);
  };
  group(1, 'POINT');
  param(1, 'USED', 2, [], [2]);
  param(1, 'FRAMES', 2, [], [frames]);
  param(1, 'RATE', 4, [], [100]);
  param(1, 'SCALE', 4, [], [-0.5]);
  param(1, 'DATA_START', 2, [], [5]);
  param(1, 'UNITS', -1, [unit.length], unit);
  param(1, 'LABELS', -1, [5, 2], 'AlphaBeta ');
  group(2, 'ANALOG');
  param(2, 'USED', 2, [], [analog ? 2 : 0]);
  param(2, 'RATE', 4, [], [analog ? 200 : 0]);
  param(2, 'LABELS', -1, [2, 2], 'A1A2');
  param(2, 'UNITS', -1, [1, 2], 'VN');
  param(2, 'SCALE', 4, [2], [2, -3]);
  param(2, 'OFFSET', 2, [2], [10, 20]);
  param(2, 'GEN_SCALE', 4, [], [0.25]);
  group(3, 'EVENT');
  param(3, 'USED', 2, [], [1]);
  param(3, 'TIMES', 4, [2, 1], [0, 0.37]);
  param(3, 'LABELS', -1, [4, 1], 'Step');
  group(4, 'TRIAL');
  param(4, 'ACTUAL_START_FIELD', 2, [2], [37, 0]);
  param(4, 'ACTUAL_END_FIELD', 2, [2], [39, 0]);
  if (rotation) {
    group(5, rotationGroupName);
    param(5, 'USED', 2, [], [2]);
    param(5, 'DATA_START', 2, [], [rotationStart / 512 + 1]);
    param(5, 'RATE', 4, [], [100 * ratio]);
    param(5, 'RATIO', 2, [], [ratio]);
    param(5, 'LABELS', -1, [4, 2], 'BodyTool');
    if (declaredFrames !== undefined) param(5, 'FRAMES', 4, [], [declaredFrames]);
    if (unknownEncoding) param(5, 'FORMAT', -1, [4], 'QUAT');
  }
  for (let frame = 0; frame < frames; frame++) {
    let at = 2048 + frame * frameBytes;
    const values = [frame + 1, 2, 3, frame === 1 ? -1 : 5, 100 + frame, 20, 30, 3];
    if (analog) values.push(110 + frame * 10, 220 + frame * 10, 111 + frame * 10, 221 + frame * 10);
    for (const value of values) {
      view.setFloat32(at, value, little);
      at += 4;
    }
  }
  if (rotation)
    for (let i = 0; i < frames * ratio * 2; i++) {
      const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 9000 + i, 8000, 7000, 1, 0];
      matrix.forEach((value, component) =>
        view.setFloat32(rotationStart + i * 68 + component * 4, value, little),
      );
    }
  return bytes.buffer;
}
