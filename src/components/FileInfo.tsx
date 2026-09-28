import type { MotionData } from '../motion/types';
import { fileInfoSections, type InfoRow } from './fileInfoSections';

function Value({ row }: { row: InfoRow }) {
  const values = row.values.map((value, i) => (
    <span className="file-info-value" key={i} title={value}>
      {value}
    </span>
  ));
  return row.summary || row.values.length > 3 ? (
    <details>
      <summary>{row.summary ?? `${row.values.length} items`}</summary>
      {values}
    </details>
  ) : (
    <>{values}</>
  );
}

export function FileInfo({ data }: { data: MotionData }) {
  return (
    <div className="file-info" role="tabpanel" aria-label="File Info">
      {fileInfoSections(data).map((section) => (
        <section className="file-info-section" key={section.title} aria-label={section.title}>
          <h4>{section.title}</h4>
          <dl>
            {section.rows.map((row) => (
              <div key={row.label}>
                <dt>{row.label}</dt>
                <dd>
                  <Value row={row} />
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
