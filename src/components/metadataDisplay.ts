import { metadataText, type MetadataValue } from '../motion/metadata';

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
  return meaningful(value)?.replace(/^(\d{4}-\d{2}-\d{2})T(?=\d{2}:)/, '$1 ');
}
export function sourceBasename(value: string) {
  return value.split(/[\\/]/).at(-1)?.trim() ?? '';
}
