/** Independent synthetic C3D encoder: 200 Hz points, 2000 Hz TYPE-2/3/4 plate. */
export function physicalFixture(type: 2 | 3 | 4 = 2) {
  const channelCount = type === 3 ? 8 : 6;
  const frameWords = 4 + 10 * channelCount;
  const bytes = new Uint8Array(4096 + 400 * frameWords * 4);
  const v = new DataView(bytes.buffer);
  bytes[0] = 2;
  bytes[1] = 80;
  v.setUint16(2, 1, true);
  v.setUint16(4, 10 * channelCount, true);
  v.setUint16(6, 37, true);
  v.setUint16(8, 436, true);
  v.setFloat32(12, -0.5, true);
  v.setUint16(16, 9, true);
  v.setUint16(18, 10, true);
  v.setFloat32(20, 200, true);
  bytes.set([0, 80, 7, 84], 512);
  let pos = 516;
  function record(id: number, name: string, payload: number[]) {
    bytes[pos++] = name.length;
    v.setInt8(pos++, id);
    bytes.set(new TextEncoder().encode(name), pos);
    pos += name.length;
    v.setInt16(pos, payload.length + 2, true);
    pos += 2;
    bytes.set(payload, pos);
    pos += payload.length;
  }
  const group = (id: number, name: string) => record(-id, name, [0]);
  function param(
    id: number,
    name: string,
    kind: number,
    dims: number[],
    values: number[] | string,
  ) {
    const raw = new Uint8Array(typeof values === 'string' ? values.length : values.length * kind);
    const d = new DataView(raw.buffer);
    if (typeof values === 'string') raw.set(new TextEncoder().encode(values));
    else
      values.forEach((x, i) =>
        kind === 4 ? d.setFloat32(i * 4, x, true) : d.setInt16(i * 2, x, true),
      );
    record(id, name, [kind & 255, dims.length, ...dims, ...raw, 0]);
  }
  group(1, 'POINT');
  param(1, 'USED', 2, [], [1]);
  param(1, 'FRAMES', 2, [], [400]);
  param(1, 'RATE', 4, [], [200]);
  param(1, 'SCALE', 4, [], [-0.5]);
  param(1, 'DATA_START', 2, [], [9]);
  param(1, 'UNITS', -1, [2], 'mm');
  param(1, 'LABELS', -1, [1, 1], 'A');
  group(2, 'ANALOG');
  param(2, 'USED', 2, [], [channelCount]);
  param(2, 'RATE', 4, [], [2000]);
  param(2, 'SCALE', 4, [channelCount], new Array(channelCount).fill(1));
  param(
    2,
    'OFFSET',
    2,
    [channelCount],
    Array.from({ length: channelCount }, (_, i) => (i + 1) * 10),
  );
  param(2, 'GEN_SCALE', 4, [], [0.1]);
  param(2, 'LABELS', -1, [2, channelCount], type === 3 ? 'X1X2Y1Y2Z1Z2Z3Z4' : 'FxFyFzMxMyMz');
  group(3, 'FORCE_PLATFORM');
  param(3, 'USED', 2, [], [1]);
  param(3, 'TYPE', 2, [1], [type]);
  param(
    3,
    'CHANNEL',
    2,
    [channelCount, 1],
    Array.from({ length: channelCount }, (_, i) => i + 1),
  );
  param(3, 'ORIGIN', 4, [3, 1], [0, 0, -40]);
  param(3, 'CORNERS', 4, [3, 4, 1], [100, 100, 0, -100, 100, 0, -100, -100, 0, 100, -100, 0]);
  param(3, 'ZERO', 2, [2], [0, 0]);
  if (type === 4)
    param(
      3,
      'CAL_MATRIX',
      4,
      [6, 6, 1],
      Array.from({ length: 36 }, (_, i) => (i % 7 === 0 ? 1 : 0)),
    );
  group(4, 'EVENT');
  param(4, 'USED', 2, [], [4]);
  param(4, 'TIMES', 4, [2, 4], [0, 0.43, 0, 0.68, 0, 1.18, 0, 1.68]);
  param(4, 'LABELS', -1, [1, 4], 'ABCD');
  param(4, 'CONTEXTS', -1, [1, 4], 'LRLR');
  group(5, 'VENDOR');
  param(5, 'CALIBRATION', 4, [3], [1.234, 5.678, 9.012]);
  group(6, 'TRIAL');
  param(6, 'ACTUAL_START_FIELD', 2, [2], [37, 0]);
  param(6, 'ACTUAL_END_FIELD', 2, [2], [436, 0]);
  for (let f = 0; f < 400; f++) {
    let offset = 4096 + f * frameWords * 4;
    [f, f + 1, f + 2, f === 123 ? -1 : 5].forEach((x) => {
      v.setFloat32(offset, x, true);
      offset += 4;
    });
    for (let sub = 0; sub < 10; sub++)
      for (let c = 0; c < channelCount; c++) {
        v.setFloat32(offset, 1000 + f * 10 + sub + c, true);
        offset += 4;
      }
  }
  return bytes.buffer;
}
