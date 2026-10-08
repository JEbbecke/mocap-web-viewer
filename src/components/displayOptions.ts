import type { MotionData } from '../motion/types';
import type { DisplayKey } from '../state/session';

/** Scene layers are view state; local-frame options require the corresponding category. */
export function displayOptions(data: MotionData): [DisplayKey, string][] {
  return [
    ['markers', 'Markers'],
    ['connections', 'Marker connections'],
    ['plates', 'Force plates'],
    ['plateNumbers', 'Force plate numbers'],
    ...(data.forcePlatforms.length
      ? ([['plateCoordinateSystems', 'Force platform coordinate systems']] as [
          DisplayKey,
          string,
        ][])
      : []),
    ...(data.rigidBodies?.length
      ? ([['rigidBodyCoordinateSystems', 'Rigid body coordinate systems']] as [
          DisplayKey,
          string,
        ][])
      : []),
    ['forces', 'Ground reaction forces'],
    ['cop', 'Centre of pressure'],
    ['labels', 'Marker labels'],
    ['grid', 'Ground grid'],
    ['axes', 'Coordinate axes'],
  ];
}
