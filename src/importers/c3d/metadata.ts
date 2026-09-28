import {
  metadataValue,
  metadataValues,
  type RecordingInfo,
  type MetadataValue,
} from '../../motion/metadata';
import { number, nums, type Parameters } from './parameters';

/** SUBJECT(S) is application-specific. Map only explicit field names, never infer
 * age from birth date, mass from WEIGHT, ID from NAME, or units from POINT:UNITS. */
export function c3dRecordingInfo(p: Parameters): RecordingInfo {
  const scalar = (key: string) => {
    const values = metadataValues(p.get(key)?.values);
    return values.length === 1 ? values[0] : undefined;
  };
  const subject: NonNullable<RecordingInfo['subject']> = {};
  const names = metadataValue(p.get('SUBJECTS:NAMES')?.values ?? p.get('SUBJECT:NAME')?.values);
  if (names) subject.name = names;
  // No demographic-to-subject association is invented for multi-subject records.
  const multipleSubjects =
    (p.get('SUBJECTS:NAMES')?.values.length ?? 0) > 1 || number(p, 'SUBJECTS:USED', 0) > 1;
  if (!multipleSubjects) {
    const fields = {
      id: ['SUBJECTID', 'SUBJECT_ID', 'ID'],
      age: ['AGE'],
      sex: ['SEX'],
      height: ['BODYHEIGHT', 'BODY_HEIGHT', 'HEIGHT'],
      mass: ['BODYMASS', 'BODY_MASS', 'MASS'],
      condition: ['CONDITION'],
    } as const;
    for (const [field, aliases] of Object.entries(fields)) {
      let found: MetadataValue | undefined;
      for (const group of ['SUBJECT', 'SUBJECTS']) {
        for (const alias of aliases) {
          const key = `${group}:${alias}`;
          // Only singleton fields: an application-specific array might be per-subject.
          if (p.get(key)?.values.length !== 1) continue;
          found = metadataValue(
            p.get(key)?.values,
            p.get(`${key}_UNITS`)?.values ?? p.get(`${key}_UNIT`)?.values,
          );
          if (found) break;
        }
        if (found) break;
      }
      if (found) subject[field as keyof typeof fields] = found;
    }
  }
  const software = scalar('MANUFACTURER:SOFTWARE');
  const version = scalar('MANUFACTURER:VERSION_LABEL') ?? scalar('MANUFACTURER:VERSION');
  return {
    subject,
    manufacturer: scalar('MANUFACTURER:COMPANY'),
    software: software ? [software, version].filter(Boolean).join(' ') : undefined,
    platformTypes: nums(p, 'FORCE_PLATFORM:TYPE')
      .slice(0, Math.max(0, number(p, 'FORCE_PLATFORM:USED', 0)))
      .filter((v) => Number.isSafeInteger(v) && v > 0),
    // C3D screen axes describe viewing, not a lab coordinate system. TRIAL frame
    // indices, ambiguous DATE parameters and browser lastModified are not dates.
  };
}
