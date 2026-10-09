/** Curated source facts, separate from the unchanged raw metadata/export backing. */
export interface MetadataValue {
  values: string[];
  unit?: string;
}
/** Small model catalog and timing facts; numerical samples remain source-backed. */
export interface ModelResultInfo {
  variables?: number;
  samples?: number;
  metadata?: string;
  inDegrees?: boolean;
  timeBasis?: 'independent' | 'trial-aligned';
  /** Retained source sample range and trial origin for lazy aligned column reads. */
  sourceRange?: { start: number; end: number };
  timeOrigin?: number;
  entries?: {
    name: string;
    unit?: string;
    rate?: number;
    sourceIndex?: number;
    coordinateType?: 'rotation' | 'translation';
  }[];
}
export interface RecordingInfo {
  created?: string;
  coordinateSystem?: string;
  manufacturer?: string;
  software?: string;
  platformTypes?: number[];
  emgChannels?: number;
  subject?: Partial<
    Record<'id' | 'name' | 'group' | 'age' | 'sex' | 'height' | 'mass' | 'condition', MetadataValue>
  >;
  provenance?: Partial<
    Record<
      | 'project'
      | 'projectPI'
      | 'originalFiles'
      | 'sourcePath'
      | 'createdLocal'
      | 'createdUTC'
      | 'lastUpdated',
      MetadataValue
    >
  >;
  location?: Partial<Record<'latitude' | 'longitude', MetadataValue>>;
  modelResults?: Partial<Record<'ik' | 'id', ModelResultInfo>>;
}

/** Only scalar metadata is interpreted. Never stringify arbitrary objects or trees. */
export function metadataText(raw: unknown): string | undefined {
  if (typeof raw === 'number') return Number.isFinite(raw) ? String(raw) : undefined;
  if (typeof raw === 'bigint') return String(raw);
  if (typeof raw !== 'string') return;
  const text = raw.trim();
  if (!text || /^(unknown|n\/?a|null|undefined|nan|\[\s*\]|\{\s*\})$/i.test(text)) return;
  return text;
}

export function metadataValues(raw: unknown): string[] {
  const values = Array.isArray(raw)
    ? raw
    : ArrayBuffer.isView(raw) && !(raw instanceof DataView)
      ? Array.from(raw as unknown as ArrayLike<unknown>)
      : [raw];
  return values.flatMap((v) => {
    const text = metadataText(v);
    return text === undefined ? [] : [text];
  });
}

export function metadataValue(raw: unknown, rawUnit?: unknown): MetadataValue | undefined {
  const values = metadataValues(raw);
  if (!values.length) return;
  const units = metadataValues(rawUnit);
  return { values, ...(units.length === 1 ? { unit: units[0] } : {}) };
}

/** OriginalFiles may be an array, JSON, or a quoted list.
 * Accept only flat quoted strings; never evaluate code or split filenames at commas. */
export function originalFiles(raw: unknown): MetadataValue | undefined {
  if (typeof raw === 'string' && raw.trim().startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every((v) => typeof v === 'string'))
        return metadataValue(parsed);
    } catch {
      /* Flat quoted lists can use single quotes instead of JSON. */
    }
    const text = raw.trim();
    if (text.endsWith(']')) {
      const body = text.slice(1, -1).trim(),
        files: string[] = [];
      const item = /\s*(?:'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)")\s*(,|$)/gy;
      let at = 0;
      while (at < body.length) {
        item.lastIndex = at;
        const match = item.exec(body);
        if (!match) break;
        files.push((match[1] ?? match[2]).replace(/\\(['"\\])/g, '$1'));
        at = item.lastIndex;
      }
      if (at === body.length) return metadataValue(files);
    }
  }
  return metadataValue(raw);
}
