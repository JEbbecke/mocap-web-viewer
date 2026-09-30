/** Shared rules; uniqueness is scoped to one source collection, not all signals. */
export function validateLabel(
  labels: string[],
  index: number,
  input: string,
  format: string,
  kind: string,
) {
  const title = kind[0].toUpperCase() + kind.slice(1);
  if (!Number.isInteger(index) || index < 0 || index >= labels.length)
    throw new Error(`${title} no longer exists.`);
  const label = input.trim();
  if (!label) throw new Error(`Enter ${/^[aeiou]/i.test(kind) ? 'an' : 'a'} ${kind} label.`);
  if (/[\u0000-\u001f\u007f]/.test(label))
    throw new Error(`${title} labels cannot contain control characters.`);
  if (labels.some((other, i) => i !== index && other === label))
    throw new Error(`Another ${kind} already has this label.`);
  if (format === 'C3D' && new TextEncoder().encode(label).length > 255)
    throw new Error(`C3D ${kind} labels support at most 255 UTF-8 bytes.`);
  return label;
}
