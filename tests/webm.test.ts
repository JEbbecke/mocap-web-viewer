import { expect, it } from 'vitest';
import { webmBlob } from '../src/viewer/webm';
import { videoFrameTime, videoSchedule } from '../src/viewer/videoTiming';
// @ts-expect-error Test-only JavaScript parser independently inspects actual container bytes.
import { inspectWebm } from '../scripts/webm-inspect.mjs';

it.each(['V_VP8', 'V_VP9'] as const)(
  'writes parseable %s WebM with exact duration, frames, references and seek cues',
  async (codec) => {
    const schedule = videoSchedule(0, 1.01, 30, 1);
    const packets = Array.from({ length: schedule.frameCount }, (_, i) => ({
      ...videoFrameTime(schedule, i),
      key: i % 15 === 0,
      bytes: new Uint8Array([i, 1, 2, 3]),
    }));
    const blob = webmBlob(packets, 1920, 1080, codec, schedule.durationUs, 'video/webm');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect([...bytes.slice(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
    const parsed = inspectWebm(bytes);
    expect(parsed).toMatchObject({
      width: 1920,
      height: 1080,
      codecID: codec,
      durationSeconds: 1.01,
    });
    expect(parsed.packets).toHaveLength(31);
    for (let i = 0; i < packets.length; i++)
      expect(parsed.packets[i]).toMatchObject({
        timestamp: packets[i].timestamp,
        duration: packets[i].duration,
        key: packets[i].key,
        bytes: packets[i].bytes,
      });
    expect(parsed.cues).toHaveLength(3);
    expect(parsed.cues.every((cue: { element: number }) => cue.element === 0x1f43b675)).toBe(true);
  },
);
it('refuses empty/incomplete video beginnings', () => {
  expect(() => webmBlob([], 1920, 1080, 'V_VP8', 1e6, 'video/webm')).toThrow('complete');
  expect(() =>
    webmBlob(
      [{ timestamp: 0, duration: 33333, key: false, bytes: new Uint8Array([1]) }],
      1920,
      1080,
      'V_VP8',
      33333,
      'video/webm',
    ),
  ).toThrow('complete');
});
