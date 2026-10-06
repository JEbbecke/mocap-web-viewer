import type { MetadataValue, RecordingInfo } from './metadata';

/** JE_METADATA v1: explicit curated fields, independent of vendor parameter names.
 * JSON preserves arrays, units and text exactly; ASCII escaping makes chunks safe
 * for readers that trim C3D character padding or do not decode UTF-8. */
const valueFields = {
  subject: {
    id: 'SUBJECT_ID',
    name: 'SUBJECT_NAME',
    group: 'SUBJECT_GROUP',
    age: 'SUBJECT_AGE',
    sex: 'SUBJECT_SEX',
    height: 'SUBJECT_HEIGHT',
    mass: 'SUBJECT_MASS',
    condition: 'SUBJECT_CONDITION',
  },
  provenance: {
    project: 'PROJECT',
    projectPI: 'PROJECT_PI',
    originalFiles: 'ORIGINAL_FILES',
    sourcePath: 'SOURCE_PATH',
    createdLocal: 'CREATED_LOCAL',
    createdUTC: 'CREATED_UTC',
    lastUpdated: 'LAST_UPDATED',
  },
  location: { latitude: 'LATITUDE', longitude: 'LONGITUDE' },
} as const;
const textFields = {
  created: 'CREATED',
  coordinateSystem: 'COORDINATES',
  manufacturer: 'MANUFACTURER',
  software: 'SOFTWARE',
} as const;

export function hasC3DMetadata(info?: RecordingInfo): boolean {
  return (
    Object.keys(valueFields).some((key) =>
      Object.values(info?.[key as keyof typeof valueFields] ?? {}).some(Boolean),
    ) || Object.keys(textFields).some((key) => info?.[key as keyof typeof textFields] !== undefined)
  );
}

export function c3dMetadataEntries(info?: RecordingInfo): { name: string; chunks: string[] }[] {
  const entries: { name: string; chunks: string[] }[] = [];
  const add = (name: string, value: string | MetadataValue) => {
    const json = JSON.stringify(value).replace(
      /[^\x21-\x7e]/g,
      (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
    );
    entries.push({ name, chunks: json.match(/.{1,240}/g)! });
  };
  const section = <K extends string>(
    fields: Record<K, string>,
    values?: Partial<Record<K, MetadataValue>>,
  ) => {
    for (const key of Object.keys(fields) as K[]) {
      const value = values?.[key];
      if (value) add(fields[key], value);
    }
  };
  section(valueFields.subject, info?.subject);
  section(valueFields.provenance, info?.provenance);
  section(valueFields.location, info?.location);
  for (const key of Object.keys(textFields) as (keyof typeof textFields)[]) {
    const value = info?.[key];
    if (value !== undefined) add(textFields[key], value);
  }
  return entries.length ? [{ name: 'VERSION', chunks: ['1'] }, ...entries] : [];
}

/** Ignore unsupported versions and malformed fields without replacing vendor facts. */
export function readC3DMetadata(read: (name: string) => string[]): RecordingInfo {
  if (read('VERSION').join('') !== '1') return {};
  const json = (name: string): unknown => {
    const chunks = read(name);
    if (!chunks.length || !chunks.every((c) => typeof c === 'string')) return;
    try {
      return JSON.parse(chunks.join(''));
    } catch {
      return;
    }
  };
  const section = <K extends string>(fields: Record<K, string>) => {
    const values: Partial<Record<K, MetadataValue>> = {};
    for (const key of Object.keys(fields) as K[]) {
      const raw = json(fields[key]);
      if (!raw || typeof raw !== 'object' || !('values' in raw)) continue;
      if (!Array.isArray(raw.values) || !raw.values.every((v) => typeof v === 'string')) continue;
      if ('unit' in raw && typeof raw.unit !== 'string') continue;
      values[key] = {
        values: raw.values,
        ...('unit' in raw ? { unit: raw.unit as string } : {}),
      };
    }
    return Object.keys(values).length ? values : undefined;
  };
  const info: RecordingInfo = {};
  const subject = section(valueFields.subject);
  const provenance = section(valueFields.provenance);
  const location = section(valueFields.location);
  if (subject) info.subject = subject;
  if (provenance) info.provenance = provenance;
  if (location) info.location = location;
  for (const key of Object.keys(textFields) as (keyof typeof textFields)[]) {
    const value = json(textFields[key]);
    if (typeof value === 'string') info[key] = value;
  }
  return info;
}
