import { useRef } from 'react';
import licenseText from '../../LICENSE?raw';
import notice from '../../NOTICE?raw';
import thirdPartyNotices from '../../THIRD_PARTY_NOTICES.md?raw';

export function LicenseInfo() {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button className="footer-license" onClick={() => dialog.current?.showModal()}>
        Noncommercial License
      </button>
      <dialog
        ref={dialog}
        className="export-dialog license-dialog"
        aria-labelledby="license-heading"
      >
        <h2 id="license-heading">JE Motion Lab License</h2>
        <p>JE Motion Lab is source-available under the PolyForm Noncommercial License 1.0.0.</p>
        <p>
          Noncommercial use, modification, and redistribution are permitted subject to the license
          terms. The public license does not grant commercial use. Commercial use requires a
          separate commercial license from Jonas Ebbecke.
        </p>
        <p>
          For commercial licensing, use the contact details in the{' '}
          <a href="https://jemolab.com/imprint.html" target="_blank" rel="noopener noreferrer">
            Imprint
          </a>
          .
        </p>
        <pre className="legal-text">{notice}</pre>
        <p>
          <a
            href="https://polyformproject.org/licenses/noncommercial/1.0.0"
            target="_blank"
            rel="noopener noreferrer"
          >
            Official PolyForm terms
          </a>
        </p>
        <details>
          <summary>Full license terms</summary>
          <pre className="legal-text">{licenseText}</pre>
        </details>
        <details>
          <summary>Third-party notices</summary>
          <pre className="legal-text">{thirdPartyNotices}</pre>
        </details>
        <div className="export-dialog-actions">
          <button onClick={() => dialog.current?.close()}>Close</button>
        </div>
      </dialog>
    </>
  );
}
