/** Timestamp text is retained at source precision; naive clocks never acquire a timezone. */
export type FileTimestamp =
  | { status: 'missing'; source?: string }
  | { status: 'invalid'; source?: string; raw: string }
  | {
      status: 'valid';
      source?: string;
      raw: string;
      value: string;
      timezone: 'unspecified' | 'utc' | 'offset';
    };

export interface EmbeddedTimestamps {
  created: FileTimestamp;
  createdUTC?: FileTimestamp;
  modified: FileTimestamp;
}
export interface FileProperties {
  origin: 'local' | 'bundled-demo';
  name: string;
  sizeBytes: number;
  /** Browser File APIs do not expose the original filesystem creation date. */
  createdAt: null;
  modifiedAt: FileTimestamp;
}

/** ISO extended dates/clocks and the reference H5's space-separated microsecond clocks. */
export function parseFileTimestamp(raw: unknown, source?: string): FileTimestamp {
  if (Array.isArray(raw) && raw.length <= 1) raw = raw[0];
  if (ArrayBuffer.isView(raw) && !(raw instanceof DataView)) {
    const values = raw as unknown as ArrayLike<unknown>;
    if (values.length <= 1) raw = values[0];
  }
  if (
    raw == null ||
    (typeof raw === 'string' && /^(\s*|unknown|n\/?a|null|undefined|[-–—]+)$/i.test(raw.trim()))
  )
    return { status: 'missing', source };
  const text = typeof raw === 'string' ? raw.trim() : String(raw);
  const invalid: FileTimestamp = { status: 'invalid', raw: text, source };
  if (typeof raw !== 'string') return invalid;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})(?:[Tt ](\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?([Zz]|[+-]\d{2}:?\d{2})?)?$/.exec(
      text,
    );
  if (!match) return invalid;
  const [, year, month, day, hour, minute, second, fraction, zone] = match;
  const y = Number(year),
    m = Number(month),
    d = Number(day);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (m < 1 || m > 12 || d < 1 || d > days[m - 1]) return invalid;
  if (
    hour !== undefined &&
    (Number(hour) > 24 ||
      Number(minute) > 59 ||
      Number(second ?? 0) > 59 ||
      (Number(hour) === 24 &&
        (Number(minute) !== 0 || Number(second ?? 0) !== 0 || Number(fraction ?? 0) !== 0)))
  )
    return invalid;
  if (zone && !/^[Zz]$/.test(zone)) {
    const offset = zone.slice(1).replace(':', '');
    if (Number(offset.slice(0, 2)) > 23 || Number(offset.slice(2)) > 59) return invalid;
  }
  return {
    status: 'valid',
    source,
    raw: text,
    value: text
      .replace(/[Tt]/, ' ')
      .replace(/z$/, 'Z')
      .replace(/([+-]\d{2})(\d{2})$/, '$1:$2'),
    timezone: !zone ? 'unspecified' : /^(Z|\+00:?00)$/i.test(zone) ? 'utc' : 'offset',
  };
}

/** No reads/copies: browser properties are captured at the successful import boundary. */
export function fileProperties(
  file: File,
  origin: FileProperties['origin'] = 'local',
): FileProperties {
  const milliseconds = file.lastModified;
  const date = Number.isFinite(milliseconds) ? new Date(milliseconds) : null;
  const modifiedAt: FileTimestamp =
    origin === 'bundled-demo'
      ? { status: 'missing', source: 'Original filesystem timestamp unavailable for fetched bytes' }
      : date && Number.isFinite(date.getTime())
        ? parseFileTimestamp(date.toISOString(), 'File.lastModified')
        : { status: 'invalid', raw: String(milliseconds), source: 'File.lastModified' };
  return { origin, name: file.name, sizeBytes: file.size, createdAt: null, modifiedAt };
}

export function timestampText(timestamp?: FileTimestamp): string {
  return !timestamp || timestamp.status === 'missing'
    ? 'Not available'
    : timestamp.status === 'invalid'
      ? 'Invalid timestamp'
      : timestamp.value;
}
export function timestampTooltip(timestamp?: FileTimestamp): string | undefined {
  if (!timestamp) return;
  return [
    timestamp.source,
    timestamp.status !== 'missing' ? `Original: ${timestamp.raw}` : undefined,
    timestamp.status === 'valid' && timestamp.timezone === 'unspecified'
      ? 'Timezone not specified in source; no conversion applied.'
      : undefined,
  ]
    .filter(Boolean)
    .join('\n');
}
export function fileSizeText(size?: number): string {
  if (size === undefined || !Number.isSafeInteger(size) || size < 0) return 'Not available';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const tier = Math.min(units.length - 1, size ? Math.floor(Math.log10(size) / 3) : 0);
  return `${Number((size / 1000 ** tier).toFixed(2))} ${units[tier]}`;
}
