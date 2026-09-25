import type { MotionData } from './types';
import { positiveRate } from './math';
export function validateMotion(data: MotionData): MotionData {
  const { frameCount, rate } = data.timeline,
    count = data.markers.labels.length;
  positiveRate(rate, 'Point');
  if (!Number.isSafeInteger(frameCount) || frameCount < 1 || count < 1)
    throw new Error('The file contains no marker frames.');
  if (
    data.markers.positions.length !== frameCount * count * 3 ||
    data.markers.valid.length !== frameCount * count
  )
    throw new Error('Inconsistent marker dimensions.');
  for (const channel of data.analogs) positiveRate(channel.signal.rate, channel.name);
  for (const plate of data.forcePlatforms) {
    for (const signal of [plate.force, plate.moment, plate.cop]) {
      positiveRate(signal.rate, plate.name);
      if (signal.components !== 3 || signal.values.length % 3)
        throw new Error(`${plate.name}: invalid vector samples.`);
    }
    if (
      plate.force.values.length !== plate.moment.values.length ||
      plate.force.values.length !== plate.cop.values.length
    )
      throw new Error(`${plate.name}: inconsistent force/moment/COP lengths.`);
  }
  return data;
}
