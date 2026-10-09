import type { MotionData } from '../motion/types';
import { useSession } from '../state/session';
import { fileInfoSections } from './fileInfoSections';
import { sourceBasename } from './metadataDisplay';

/** Reuse File Info's normalized rows and clock formatting for compact trial identity. */
export function trialOverview(data: MotionData, sourceName?: string) {
  const fields = new Map(
    fileInfoSections(data).flatMap((section) =>
      section.rows.map((row) => [row.label, row.values.join(', ')] as const),
    ),
  );
  const filename = sourceBasename(sourceName ?? data.name) || fields.get('Format') || 'Trial';
  const condition = fields.get('Condition');
  return {
    title: condition || filename,
    filename,
    rows: [
      ['Subject', fields.get('Subject ID') || fields.get('Subject name')],
      ['Group', fields.get('Subject group')],
      // Condition is already the primary title; avoid a duplicate row.
      ['Created', fields.get('Date')],
    ].flatMap(([label, value]) => (value ? [{ label: label!, value }] : [])),
    summary: [
      fields.get('Format'),
      fields.get('Duration'),
      `${fields.get('Frames')} ${fields.get('Frames') === '1' ? 'frame' : 'frames'}`,
      fields.get('Point rate'),
    ]
      .filter(Boolean)
      .join(' · '),
  };
}

export function TrialOverview({ data }: { data: MotionData }) {
  const sourceName = useSession((s) => s.sourceFile?.name);
  const overview = trialOverview(data, sourceName);
  return (
    <section className="trial-overview" aria-label="Trial overview">
      <div className="eyebrow">TRIAL</div>
      <h3 title={overview.title}>{overview.title}</h3>
      {overview.rows.length > 0 && (
        <dl>
          {overview.rows.map((row) => (
            <div key={row.label}>
              <dt>{row.label}</dt>
              <dd title={row.value}>{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {overview.title !== overview.filename && (
        <div className="trial-filename muted" title={overview.filename}>
          {overview.filename}
        </div>
      )}
      <div className="trial-summary muted" title={overview.summary}>
        {overview.summary}
      </div>
    </section>
  );
}
