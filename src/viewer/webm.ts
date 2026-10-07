/** Narrow video-only WebM writer: VP8/VP9, one timestamped BlockGroup per Cluster, no audio/lacing. */
export interface WebmPacket {
  timestamp: number;
  duration: number;
  key: boolean;
  bytes: Uint8Array<ArrayBuffer>;
}
function uint(value: number) {
  let width = 1;
  while (value >= 2 ** (8 * width)) width++;
  const bytes = new Uint8Array(width);
  let remaining = value;
  for (let i = width - 1; i >= 0; i--) {
    bytes[i] = remaining % 256;
    remaining = Math.floor(remaining / 256);
  }
  return bytes;
}
function vint(value: number) {
  let width = 1;
  while (value >= 2 ** (7 * width) - 1) width++;
  const bytes = new Uint8Array(width);
  let remaining = value;
  for (let i = width - 1; i >= 0; i--) {
    bytes[i] = remaining % 256;
    remaining = Math.floor(remaining / 256);
  }
  bytes[0] |= 1 << (8 - width);
  return bytes;
}
function join(parts: Uint8Array<ArrayBuffer>[]) {
  const result = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}
function element(id: number, ...parts: Uint8Array<ArrayBuffer>[]) {
  const content = join(parts);
  return join([uint(id), vint(content.length), content]);
}
const number = (id: number, value: number) => element(id, uint(value));
const text = (id: number, value: string) => element(id, new TextEncoder().encode(value));
function float(value: number) {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setFloat64(0, value);
  return bytes;
}
function signed(value: number) {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigInt64(0, BigInt(value));
  return bytes;
}

export function webmBlob(
  packets: WebmPacket[],
  width: number,
  height: number,
  codec: 'V_VP8' | 'V_VP9',
  durationUs: number,
  mime: string,
): Blob {
  if (!packets.length || !packets[0].key || packets[0].timestamp !== 0)
    throw new Error('The encoder did not produce a complete video.');
  const ebml = element(
    0x1a45dfa3,
    number(0x4286, 1),
    number(0x42f7, 1),
    number(0x42f2, 4),
    number(0x42f3, 8),
    text(0x4282, 'webm'),
    number(0x4287, 4),
    number(0x4285, 2),
  );
  // TimestampScale=1000 ns gives microsecond precision without 30/60 fps millisecond jitter.
  const info = element(
    0x1549a966,
    number(0x2ad7b1, 1000),
    element(0x4489, float(durationUs)),
    text(0x4d80, 'JE Motion Lab'),
    text(0x5741, 'JE Motion Lab'),
  );
  const tracks = element(
    0x1654ae6b,
    element(
      0xae,
      number(0xd7, 1),
      number(0x73c5, 1),
      number(0x83, 1),
      number(0x9c, 0),
      text(0x86, codec),
      element(0xe0, number(0xb0, width), number(0xba, height)),
    ),
  );
  const parts = [info, tracks];
  const cues: Uint8Array<ArrayBuffer>[] = [];
  let offset = info.length + tracks.length,
    previous = 0;
  for (const packet of packets) {
    const block = element(0xa1, new Uint8Array([0x81, 0, 0, 0]), packet.bytes);
    const group = element(
      0xa0,
      block,
      number(0x9b, packet.duration),
      ...(packet.key ? [] : [element(0xfb, signed(previous - packet.timestamp))]),
    );
    const cluster = element(0x1f43b675, number(0xe7, packet.timestamp), group);
    if (packet.key)
      cues.push(
        element(
          0xbb,
          number(0xb3, packet.timestamp),
          element(0xb7, number(0xf7, 1), number(0xf1, offset)),
        ),
      );
    parts.push(cluster);
    offset += cluster.length;
    previous = packet.timestamp;
  }
  parts.push(element(0x1c53bb6b, ...cues));
  const segmentHeader = join([
    uint(0x18538067),
    vint(parts.reduce((n, part) => n + part.length, 0)),
  ]);
  return new Blob([ebml.buffer, segmentHeader.buffer, ...parts.map((part) => part.buffer)], {
    type: mime,
  });
}
