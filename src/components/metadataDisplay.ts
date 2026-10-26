import { metadataText, type MetadataValue } from '../motion/metadata';
import { parseFileTimestamp, type FileTimestamp } from '../motion/fileMetadata';

const meaningful = (value: unknown) => {
  const text = metadataText(value);
  return text && !/^[-–—]+$/.test(text) ? text : undefined;
};

/** Shared normalized display fields; no source-schema interpretation. */
export function metadataFieldValues(value?: MetadataValue) {
  const unit = metadataText(value?.unit);
  return (value?.values ?? []).flatMap((raw) => {
    const text = meaningful(raw);
    return text ? [unit ? `${text} ${unit}` : text] : [];
  });
}
export function metadataTimestamp(value?: string) {
  const timestamp = parseFileTimestamp(value);
  if (timestamp.status !== 'valid') return;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}:\d{2}(?::\d{2})?)(?:\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/.exec(
      timestamp.value,
    );
  if (!match) return timestamp.value;
  const [, year, month, day, clock, zone] = match;
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return `${day} ${months[Number(month) - 1]} ${year}${clock ? `, ${clock}` : ''}${zone ? (zone === 'Z' || zone === '+00:00' ? ' UTC' : ` ${zone}`) : ''}`;
}

/** Deliberate date/clock lines in narrow metadata panels; no timezone conversion. */
export function metadataTimestampParts(value?: string) {
  const formatted = metadataTimestamp(value);
  if (!formatted) return;
  const [date, time] = formatted.split(', ');
  return { date, time };
}

/** Compare explicit instants at full source precision, never infer a naive clock's offset. */
export function sameTimestampInstant(a?: FileTimestamp, b?: FileTimestamp): boolean {
  const instant = (timestamp?: FileTimestamp) => {
    if (
      timestamp?.status !== 'valid' ||
      timestamp.timezone === 'unspecified' ||
      timestamp.value.endsWith('-00:00')
    )
      return;
    const value = timestamp.value.replace(' ', 'T');
    const fraction = /\.(\d+)/.exec(value)?.[1].replace(/0+$/, '') ?? '';
    const milliseconds = Date.parse(value.replace(/\.\d+/, ''));
    return Number.isFinite(milliseconds) ? { milliseconds, fraction } : undefined;
  };
  const first = instant(a),
    second = instant(b);
  return (
    !!first &&
    !!second &&
    first.milliseconds === second.milliseconds &&
    first.fraction === second.fraction
  );
}
export function sourceBasename(value: string) {
  return value.split(/[\\/]/).at(-1)?.trim() ?? '';
}
