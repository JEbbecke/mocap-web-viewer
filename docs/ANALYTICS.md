# Anonymous usage analytics

MoCap processing remains local. The browser sends only usage event types to a
separate Cloudflare Worker; it never sends MoCap files, filenames, marker labels,
source metadata or measurements to analytics. The application payload and the
network infrastructure have different privacy properties; see [README privacy](../README.md#privacy).

The footer's [Privacy](https://jemolab.com/privacy.html) and
[Imprint](https://jemolab.com/imprint.html) links open the authoritative external
legal pages. This document describes technical analytics behavior and does not
duplicate those pages' legal text.

## Client behavior

These client behaviors apply to the JE Motion Lab web app at
[app.jemolab.com](https://app.jemolab.com/). The static landing page at
[jemolab.com](https://jemolab.com/) is maintained separately. The Worker hostname
and analytics event names retain their existing identifiers across branding changes.

[`src/analytics.ts`](../src/analytics.ts) posts JSON to
`https://je-motion-analytics.jonasebbecke97.workers.dev/event` with
`Content-Type: application/json`. Each body has exactly one `event` field:

| Event        | Trigger                                                             | Counting limits                                                                                                                                         |
| ------------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `visit`      | App mounts                                                          | Sent once on each application load. Reloading the page sends another `visit`. This is an application-load count, not a unique visitor or session count. |
| `c3d_loaded` | The import worker successfully returns a `.c3d` recording           | Every successful load counts, including re-importing an export or the same file.                                                                        |
| `h5_loaded`  | The import worker successfully returns a `.h5` or `.hdf5` recording | Both extensions share one event type; every successful load counts.                                                                                     |

[`App.tsx`](../src/App.tsx) sends one visit on each mount;
[`state/session.ts`](../src/state/session.ts) sends load events only after a
successful import. Failed, cancelled and unsupported imports do not emit load
events. Playback, cropping, event edits and exports do not emit
their own analytics events. The file extension selects the load event locally;
the filename is never included in the request.

The `visit` event is emitted once on each application load. Reloading the page
therefore emits another `visit` event. The backend field remains named `visits`
for compatibility, but the value represents application loads rather than unique
visitors or unique sessions.

Analytics does not use cookies, sessionStorage, localStorage, IndexedDB, Cache
Storage, persistent identifiers or browser fingerprinting. No visit state is
persisted across page loads. An instance-local React ref prevents StrictMode's
development-only effect replay from sending a second visit. It resets with each
new mounted App instance, including page reloads, and contains no identifier.

No IDs, UUIDs, timestamps, filenames, paths, file sizes, labels, recording
metadata, measurements, device profiles or application versions are added to the
payload. Fetch uses the default `same-origin` credentials mode, so credentials
are not included on cross-origin analytics requests. The page's `no-referrer`
policy suppresses `Referer`; CORS still supplies an `Origin` header. These settings
do not conceal the IP address or other normal browser-supplied headers.

Analytics runs in production, local development and preview. There is no client
queue or retry: rejected responses and fetch failures produce only a local debug
message. Blocking or losing requests can therefore undercount activity.

Analytics failures are best-effort and never interrupt application use. Imported
recordings and edits live in memory, never in browser storage. File conversion
and export happen locally and export requires explicit user action.

## Cloudflare Worker and D1

The web app sends `POST /event` only; it does not retrieve or display aggregate
statistics. The existing `GET /stats` endpoint remains available to the separately
maintained [jemolab.com landing page](https://jemolab.com/). Its response fields
remain `visits`, `c3d_loaded`, `h5_loaded`, `files_loaded` and a `countries` array of
`{ country, visits }` entries. No Worker/API/D1 schema or country aggregation
changes are part of this client cleanup.

The documented backend design is a Cloudflare Worker that derives approximate
country from Cloudflare request information and increments daily D1 counts keyed
by date, country and event type. Country is infrastructure-derived, not supplied by
the browser payload or read from a recording. Cloudflare exposes a country code
through its [Worker request metadata](https://developers.cloudflare.com/workers/runtime-apis/request/#incomingrequestcfproperties).

The Worker source, D1 schema/migrations and deployment/logging configuration are
not present in this repository. Client inspection cannot establish whether the
deployed service stores only those aggregates, how dates/unknown countries are
handled, or how long infrastructure logs are retained. Verify these against the
separately managed service before asserting database-only storage or retention
guarantees. No Worker or D1 deployment is performed by the
[Pages workflow](../.github/workflows/deploy.yml).

The intended analytics records contain no user identifiers. This does not make
the HTTP connection anonymous: hosting and Cloudflare receive normal connection
information, including IP addresses and browser-supplied headers, and may process
or log it independently of D1 aggregates. The absence of those fields in the JSON
payload does not prove that infrastructure never receives or retains them.

## CSP and network behavior

[`vite.config.ts`](../vite.config.ts) injects the CSP into the HTML at build/serve
time. Production uses:

```text
connect-src 'self' https://je-motion-analytics.jonasebbecke97.workers.dev
```

This allowlist covers origins, including any path at the analytics origin. It does
not validate payloads. Development additionally allows `ws://127.0.0.1:*` and
`ws://localhost:*` for Vite, and permits the inline development preamble. Both
modes use bundled scripts/workers and embedded HDF5 WASM, with no runtime CDN or
remote fonts. Frames, objects and form submissions remain blocked.

Normal app traffic consists of same-origin application asset requests and
analytics JSON POSTs; cross-origin JSON POSTs can trigger
an OPTIONS preflight. The separately
managed Worker must provide CORS responses for the intended application origins.
The footer's GitHub, Privacy and Imprint links navigate separately; `connect-src`
is not a blanket ban on browser navigation or all network activity.

## Verification

After `npm test` and `npm run build`, run `npm run test:browser`. The browser check
intercepts the analytics origin locally and verifies the fixed event endpoint,
methods and exact event-only POST bodies. It checks one visit on initial mount,
another after the single deliberate reload, successful load events, and no load
events for viewer controls, failed imports or cancelled imports. Any other
analytics endpoint or GET fails the request allowlist, so aggregate statistics
cannot be fetched in the tested flow. Analytics does not use sessionStorage,
localStorage, Cache Storage, IndexedDB or cookies; all are checked to be empty in
the test context. Unit tests also verify that rejected HTTP responses and network
failures resolve without retrying. This validates the client, not live Worker
CORS, country aggregation, D1 contents or infrastructure logging.

Local reports remain under ignored `.local/`. See [validation](VALIDATION.md) and
[release checks](RELEASING.md) for the surrounding workflow.
