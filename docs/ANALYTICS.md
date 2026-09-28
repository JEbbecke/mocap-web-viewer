# Anonymous usage analytics

MoCap processing remains local. The browser sends only usage event types to a
separate Cloudflare Worker; it never sends MoCap files, filenames, marker labels,
source metadata or measurements to analytics. The application payload and the
network infrastructure have different privacy properties; see [README privacy](../README.md#privacy).

## Client behavior

[`src/analytics.ts`](../src/analytics.ts) posts JSON to
`https://je-motion-analytics.jonasebbecke97.workers.dev/event` with
`Content-Type: application/json`. Each body has exactly one `event` field:

| Event        | Trigger                                                             | Counting limits                                                                                                                         |
| ------------ | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `visit`      | App mounts without the `je-motion-visit-counted` session flag       | The flag is set to `true` before sending, so reloads in that tab session do not retry or count again. It is not a unique visitor count. |
| `c3d_loaded` | The import worker successfully returns a `.c3d` recording           | Every successful load counts, including re-importing an export or the same file.                                                        |
| `h5_loaded`  | The import worker successfully returns a `.h5` or `.hdf5` recording | Both extensions share one event type; every successful load counts.                                                                     |

[`App.tsx`](../src/App.tsx) owns the visit flag;
[`state/session.ts`](../src/state/session.ts) sends load events only after a
successful import. Failed, cancelled and unsupported imports do not emit load
events. Playback, cropping, event edits and exports do not emit
their own analytics events. The file extension selects the load event locally;
the filename is never included in the request.

The session flag contains no identifier and is never transmitted. Tab duplication
or session restoration can preserve browser session storage, so visits should not
be interpreted as an exact count of newly opened tabs or people. Clearing that
storage permits another visit attempt. No persistent identifier, fingerprint,
tracking cookie, device profile, file size or application version is added to the
payload. Fetch uses the default `same-origin` credentials mode, so credentials
are not included on cross-origin analytics requests. The page's `no-referrer`
policy suppresses `Referer`; CORS still supplies an `Origin` header. These settings
do not conceal the IP address or other normal browser-supplied headers.

Analytics runs in production, local development and preview. There is no client
queue or retry: rejected responses and fetch failures produce only a local debug
message. A failed visit request leaves the flag set. Blocking or losing requests
can therefore undercount activity. The current visit effect assumes that
`sessionStorage` is accessible; it has no fallback for a browser that throws on
storage access.

## Cloudflare Worker and D1

The client also reads `/stats` once on application mount with a bodyless GET.
The response includes `visits`, `c3d_loaded`, `h5_loaded`, `files_loaded` and a
`countries` array of `{ country, visits }` entries. While no recording is
loaded, the landing page shows visits, the number of country entries and the
combined `files_loaded` total. Invalid or unavailable totals leave the summary
hidden; the example display numbers are not fallback data. This read does not
send recording information or create an analytics event.

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

Normal traffic consists of same-origin application asset requests, a GET for
aggregate statistics and analytics JSON POSTs; cross-origin JSON POSTs can trigger
an OPTIONS preflight. The separately
managed Worker must provide CORS responses for the intended application origins.
External links, such as the footer's GitHub link, navigate separately; `connect-src`
is not a blanket ban on browser navigation or all network activity.

## Verification

After `npm test` and `npm run build`, run `npm run test:browser`. The browser check
intercepts the analytics origin locally, verifies the exact endpoints, methods,
bodyless stats reads and event-only POST bodies, and checks the landing summary,
its absence for invalid stats, visit suppression on reload, successful load events,
the lack of additional load events for viewer controls or a failed import, and the one permitted
session flag. Other requests must be local assets; localStorage, Cache Storage,
IndexedDB and cookies remain empty in the test context. This validates the client,
not live Worker CORS, country aggregation, D1 contents or infrastructure logging.

Local reports remain under ignored `.local/`. See [validation](VALIDATION.md) and
[release checks](RELEASING.md) for the surrounding workflow.
