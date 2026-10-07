import {
  metadataText,
  metadataValue,
  metadataValues,
  originalFiles,
  type RecordingInfo,
} from '../../motion/metadata';
import type { H5Node } from './schema';
import { modelCoordinateType } from '../../motion/modelUnits';

/** Reads attributes and dataset shapes only; no IK/ID samples are loaded or interpreted. */
export function h5RecordingInfo(root: H5Node): RecordingInfo {
  const group = (path: string) => root.get?.(path) as H5Node | undefined;
  const meta = group('MetaData');
  const project = group('MetaData/Project'),
    fileInfo = group('MetaData/FileInfo');
  const fileKeys = new Set([
    'FileCreationLocal',
    'FileCreationUTC',
    'LastUpdate',
    'OriginalFiles',
    'PathFile',
  ]);
  const attr = (key: string) =>
    (fileKeys.has(key.replace(/Units?$/, '')) ? fileInfo : project)?.attrs?.[key]?.value;
  const field = (key: string) =>
    metadataValue(attr(key), attr(`${key}Unit`) ?? attr(`${key}Units`));
  const createdLocal = field('FileCreationLocal'),
    createdUTC = field('FileCreationUTC');
  const location = meta?.get?.('Location') as H5Node | undefined;
  const results = (path: string) => {
    const data = group(`${path}/Data`);
    if (!data) return;
    const shape = data.shape;
    if (shape?.includes(0)) return;
    if (shape?.length !== 2 || !Number.isSafeInteger(shape[0]) || shape[0] < 0) return {};
    const attrs = group(path)?.attrs;
    // Preserve column indices: filtering empty labels/units would shift associations.
    const list = (raw: unknown): unknown[] =>
      Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
    const labels = list(attrs?.Labels?.value),
      units = list(attrs?.Units?.value);
    const namesMatch = labels.length === shape[0];
    const storedRate = Number(metadataText(attrs?.SamplingFrequency?.value));
    const rate = Number.isFinite(storedRate) && storedRate > 0 ? storedRate : undefined;
    const declaration = `${attrs?.inDegrees?.value ?? ''} ${attrs?.Metadata?.value ?? ''}`;
    const inDegrees =
      /^(yes|true|1)\b/i.test(declaration.trim()) ||
      /["']inDegrees["']\s*:\s*["']yes["']/i.test(declaration)
        ? true
        : /^(no|false|0)\b/i.test(declaration.trim()) ||
            /["']inDegrees["']\s*:\s*["']no["']/i.test(declaration)
          ? false
          : undefined;
    const entries = Array.from({ length: shape[0] }, (_, i) => {
      const rawName = namesMatch ? labels[i] : undefined;
      const name =
        typeof rawName === 'string' ? rawName.trim() || undefined : metadataText(rawName);
      // The institute schema can include its independent time row in Data.
      if (name?.toLowerCase() === 'time') return [];
      const unit = units.length === shape[0] ? metadataText(units[i]) : undefined;
      const coordinateType =
        path === 'IKResults' && inDegrees !== undefined && name
          ? modelCoordinateType(name)
          : undefined;
      return [
        {
          name: name ?? `Variable ${i + 1} (unlabelled)`,
          unit,
          rate,
          sourceIndex: i,
          ...(coordinateType ? { coordinateType } : {}),
        },
      ];
    }).flat();
    return {
      variables: entries.length,
      entries,
      samples: shape[1],
      timeBasis: 'independent' as const,
      metadata: typeof attrs?.Metadata?.value === 'string' ? attrs.Metadata.value : undefined,
      // A literal declaration is metadata, not permission to assign degrees to translations.
      inDegrees,
    };
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
    emgChannels: emgShape?.length === 2 ? (emgShape.includes(0) ? 0 : emgShape[0]) : undefined,
    subject: {
      id: field('SubjectID'),
      group: field('SubjectGroup'),
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
