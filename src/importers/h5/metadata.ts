import {
  metadataValue,
  metadataValues,
  originalFiles,
  type RecordingInfo,
} from '../../motion/metadata';
import type { H5Node } from './schema';

/** Reads attributes and dataset shapes only; no IK/ID samples are loaded or interpreted. */
export function h5RecordingInfo(root: H5Node): RecordingInfo {
  const group = (path: string) => root.get?.(path) as H5Node | undefined;
  const meta = group('MetaData');
  const attr = (key: string) => meta?.attrs?.[key]?.value;
  const field = (key: string) =>
    metadataValue(attr(key), attr(`${key}Unit`) ?? attr(`${key}Units`));
  const createdLocal = field('FileCreationLocal'),
    createdUTC = field('FileCreationUTC');
  const location = meta?.get?.('Location') as H5Node | undefined;
  const results = (path: string) => {
    const data = group(`${path}/Data`);
    if (!data) return;
    const shape = data.shape;
    return shape?.length === 2 && Number.isSafeInteger(shape[0]) && shape[0] >= 0
      ? { variables: shape[0] }
      : {};
  };
  const coordinates = metadataValues(group('Trajectories')?.attrs?.GlobalCoordinateSystem?.value);
  const emgShape = group('EMG/Data')?.shape;
  return {
    created:
      createdLocal?.values.length === 1
        ? createdLocal.values[0]
        : createdUTC?.values.length === 1
          ? createdUTC.values[0]
          : undefined,
    coordinateSystem: coordinates.length === 1 ? coordinates[0] : undefined,
    emgChannels: emgShape?.length === 2 ? emgShape[0] : undefined,
    subject: {
      id: field('SubjectID'),
      age: field('Age'),
      sex: field('Sex'),
      height: field('BodyHeight'),
      mass: field('BodyMass'),
      condition: field('Condition'),
    },
    provenance: {
      project: field('Project'),
      projectPI: field('ProjectPI'),
      originalFiles: originalFiles(attr('OriginalFiles')),
      sourcePath: field('PathFile'),
      createdLocal,
      createdUTC,
      lastUpdated: field('LastUpdate'),
    },
    location: {
      latitude: metadataValue(location?.attrs?.Lat?.value),
      longitude: metadataValue(location?.attrs?.Lon?.value),
    },
    modelResults: { ik: results('IKResults'), id: results('IDResults') },
  };
}
