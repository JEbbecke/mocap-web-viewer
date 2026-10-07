import type { H5Node } from './schema';

/** Identify only the current unversioned institute schema. */
export function h5Layout(root: H5Node): 'institute-current' {
  const group = (path: string) => root.get?.(path) as H5Node | undefined;
  const unsupported = (detail: string): never => {
    throw new Error(
      `Unsupported institute H5 schema: ${detail}. JE Motion Lab supports the current authoritative institute H5 schema.`,
    );
  };
  const unversioned = (node: H5Node | undefined, path: string) => {
    if (node?.attrs && 'SchemaVersion' in node.attrs)
      unsupported(`${path}: unsupported SchemaVersion`);
  };
  unversioned(root, '/');
  unversioned(group('Events'), 'Events');
  const bodies = group('RigidBodies');
  unversioned(bodies, 'RigidBodies');
  for (const key of bodies?.keys?.() ?? [])
    unversioned(bodies!.get?.(key) as H5Node, `RigidBodies/${key}`);
  const plates = group('ForcePlates');
  unversioned(plates, 'ForcePlates');
  for (const key of plates?.keys?.() ?? []) {
    const plate = plates!.get?.(key) as H5Node;
    unversioned(plate, `ForcePlates/${key}`);
    if (plate.get?.('Location') || plate.get?.('Offset'))
      unsupported(`ForcePlates/${key}: obsolete Location/Offset geometry`);
    for (const field of ['Force', 'Moment', 'COP', 'Tz']) {
      const data = plate.get?.(field) as H5Node | undefined;
      if (data?.shape && (data.shape.length !== 2 || data.shape[0] !== 3))
        unsupported(`ForcePlates/${key}/${field}: expected [3,samples]`);
    }
  }
  if (!group('MetaData/Project') && !group('MetaData/FileInfo'))
    unsupported('current nested MetaData/Project or MetaData/FileInfo is required');
  return 'institute-current';
}
