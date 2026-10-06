import type { H5Node } from './schema';
import type { MotionData } from '../../motion/types';

/** Explicit versions take precedence over structural identification of the
 * unversioned current reference. Never infer timing from arbitrary event names. */
export function h5Layout(root: H5Node): NonNullable<MotionData['source']['h5Layout']> {
  const group = (path: string) => root.get?.(path) as H5Node | undefined;
  const version = (g: H5Node | undefined) => {
    const raw = g?.attrs?.SchemaVersion?.value;
    return raw == null
      ? undefined
      : Number(
          ArrayBuffer.isView(raw) || Array.isArray(raw) ? (raw as ArrayLike<unknown>)[0] : raw,
        );
  };
  if (version(root) !== undefined)
    throw new Error('Unsupported H5 root SchemaVersion; no root version is established.');
  const events = group('Events'),
    eventVersion = version(events);
  if (eventVersion !== undefined && eventVersion !== 1)
    throw new Error(
      'Events: unsupported SchemaVersion (supported: 1 or unversioned current layout).',
    );
  const bodies = group('RigidBodies');
  if (version(bodies) !== undefined && version(bodies) !== 1)
    throw new Error('RigidBodies: unsupported SchemaVersion (supported: 1 or unversioned).');
  const plates = group('ForcePlates');
  for (const key of plates?.keys?.() ?? []) {
    const v = version(plates!.get?.(key) as H5Node);
    if (v !== undefined && v !== 2)
      throw new Error(
        `ForcePlates/${key}: unsupported SchemaVersion (supported: 2 or unversioned).`,
      );
  }
  // An Events version identifies that collection, not all other collections.
  // Transitional files can combine nested current metadata with v1 events.
  if (group('MetaData/Project') || group('MetaData/FileInfo')) return 'institute-current';
  if (eventVersion === 1) return 'institute-v1';
  const currentEvents = [
    'Name',
    'Time',
    'Frame',
    'Context',
    'Subject',
    'GenericFlag',
    'IconID',
  ].every((key) => events?.get?.(key));
  if (currentEvents) return 'institute-current';
  return 'legacy';
}
