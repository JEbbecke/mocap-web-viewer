import type { MotionData } from './types';

export function partialImportNotice(
  partial: NonNullable<MotionData['source']['partialImport']>,
  hasAnalogs: boolean,
): string {
  const count = partial.rotation.signals;
  return `File loaded with limitations: ${hasAnalogs ? 'point and analog data are' : 'point data is'} available, but ${count} rotation ${count === 1 ? 'signal was' : 'signals were'} not imported. Exports will omit these signals.`;
}

/** Source omissions apply to same-format exports as well as conversions. */
export function partialImportExportWarnings(data: MotionData): string[] {
  const partial = data.source.partialImport;
  if (!partial) return [];
  const count = partial.rotation.signals;
  return [
    `${count} rotation ${count === 1 ? 'signal' : 'signals'} not imported: JE Motion Lab could not import these source C3D signals. They will not be included in the exported file. Keep the original file to preserve them.`,
  ];
}
