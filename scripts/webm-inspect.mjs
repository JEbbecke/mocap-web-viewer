// Independent read-only parser used by smoke/unit checks; never part of the application bundle.
export function elements(bytes, start = 0, end = bytes.length) {
  const result = [];
  let offset = start;
  while (offset < end) {
    const position = offset;
    let width = 1;
    while (!(bytes[offset] & (1 << (8 - width))) && width <= 8) width++;
    if (width > 4) throw new Error('Invalid EBML element ID');
    let id = 0;
    for (let i = 0; i < width; i++) id = id * 256 + bytes[offset++];
    width = 1;
    while (!(bytes[offset] & (1 << (8 - width))) && width <= 8) width++;
    if (width > 8) throw new Error('Invalid EBML element size');
    let size = bytes[offset++] & ((1 << (8 - width)) - 1);
    for (let i = 1; i < width; i++) size = size * 256 + bytes[offset++];
    if (!Number.isSafeInteger(size) || offset + size > end)
      throw new Error('Truncated EBML element');
    result.push({ id, start: offset, end: offset + size, position });
    offset += size;
  }
  return result;
}
export function inspectWebm(bytes) {
  const children = (parent) => elements(bytes, parent.start, parent.end);
  const uint = (element) =>
    bytes.subarray(element.start, element.end).reduce((sum, byte) => sum * 256 + byte, 0);
  const top = elements(bytes),
    segment = top.find((element) => element.id === 0x18538067);
  const inside = children(segment),
    info = children(inside.find((element) => element.id === 0x1549a966));
  const scale = uint(info.find((element) => element.id === 0x2ad7b1));
  const duration = info.find((element) => element.id === 0x4489);
  const durationSeconds =
    (new DataView(bytes.buffer, bytes.byteOffset + duration.start, 8).getFloat64(0) * scale) / 1e9;
  const track = children(children(inside.find((element) => element.id === 0x1654ae6b))[0]);
  const codec = track.find((element) => element.id === 0x86);
  const codecID = new TextDecoder().decode(bytes.subarray(codec.start, codec.end));
  const video = children(track.find((element) => element.id === 0xe0));
  const width = uint(video.find((element) => element.id === 0xb0)),
    height = uint(video.find((element) => element.id === 0xba));
  const packets = [];
  for (const cluster of inside.filter((element) => element.id === 0x1f43b675)) {
    const content = children(cluster),
      timestamp = uint(content.find((element) => element.id === 0xe7));
    const group = children(content.find((element) => element.id === 0xa0));
    const block = group.find((element) => element.id === 0xa1);
    const relative = new DataView(bytes.buffer, bytes.byteOffset + block.start + 1, 2).getInt16(0);
    packets.push({
      timestamp: ((timestamp + relative) * scale) / 1000,
      duration: (uint(group.find((element) => element.id === 0x9b)) * scale) / 1000,
      key: !group.some((element) => element.id === 0xfb),
      bytes: bytes.slice(block.start + 4, block.end),
    });
  }
  const cues = children(inside.find((element) => element.id === 0x1c53bb6b)).map((point) => {
    const entry = children(point),
      position = children(entry.find((element) => element.id === 0xb7));
    const offset = uint(position.find((element) => element.id === 0xf1));
    return {
      timestamp: (uint(entry.find((element) => element.id === 0xb3)) * scale) / 1000,
      element: inside.find((element) => element.position === segment.start + offset)?.id,
    };
  });
  return { width, height, codecID, durationSeconds, packets, cues };
}
