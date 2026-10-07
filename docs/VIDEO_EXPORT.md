# Video export

Open **Export media → Export video…** beside the camera controls. Image and video
have separate dialogs; C3D/H5 data export stays in the header. Video contains only
the scientific scene with its current camera, background, visibility/colors,
connections, labels, forces, COP, moving geometry, grid and axes. The toolbar,
menu, dialog, timeline, plots and sidebar are excluded.

## Options and support

- Resolution: **1920 × 1080** (default) or **Current viewport**, using drawing-buffer
  dimensions. Video is capped at the 1920 × 1080 pixel count; larger viewports
  require the fixed option. 4K remains image-only.
- Frame rate: **30 fps** (default) or **60 fps**, independent of acquisition rates.
- Playback speed: **1×** (default), **0.5×** or **0.25×**; these are export settings.
- The optional watermark defaults to enabled and reuses exactly the PNG design,
  scaled to resolution and composited in fixed bottom-right screen coordinates.
- Estimated duration, frame progress and Cancel appear in the video dialog.

WebCodecs support is queried for the actual resolution/fps. VP9 is preferred with
VP8 fallback, in WebM. The extension always matches the container. MP4 and
MediaRecorder-only browsers are not supported. Without a supported encoder, the
video menu item is disabled with an explanation; image export stays available.
HTTPS or localhost and a usable WebGL renderer are required. No browser sniffing
or encoder dependency is used. Safari/Samsung Internet need manual checks before
video compatibility claims; automated native encoding/playback covers Chrome/Edge.

## Physical time and endpoints

The range is the current MotionData's **recorded sample span**:
`[0, timeline.duration)`, with `timeline.duration = (frameCount - 1) / pointRate`.
This is the interval between first and last marker timestamps, rather than the
half-open crop boundary `frameCount / pointRate` displayed by crop handles. No
extra final sample interval or data outside the current cropped trial is added.
Apply a crop first; an unapplied selection does not change the export range.
Single-sample/zero-duration trials can export images but cannot export video.

For physical duration `D`, speed `s` and video rate `f`, output duration is `D / s`,
frame count is `ceil(D / s * f)`, and frame `i` samples physical time `i * s / f`.
Its encoder timestamp is `round(i / f * 1,000,000)` microseconds. Frame zero includes
the beginning; all physical times precede the exclusive end. The last output
frame is shortened to end exactly at the video duration, rounded to a microsecond.
Integer frame-count noise is snapped. No duplicated endpoint frame is added.

A 1 s sample span at 30 fps/1× produces 30 frames starting at 0 through 29/30 s
and a 1 s video. At 0.5×: 60 frames, 2 s; at 0.25×: 120 frames, 4 s. Very short
non-zero clips have one shortened frame. Source frame origins remain metadata;
rebased crop times and each stream's start time/rate/explicit clock are retained.

Markers/connections/labels keep the live viewer's previous point-sample hold,
including validity gaps. Forces, COP and moving geometry use the same
`sample()`/`sample3()` interpolation at each physical time on their own clocks.
Missing samples are not invented; this display sampling never resamples stored data.

## Architecture and safety

Encoding is offline and timestamped: rendering speed changes export wall time,
not sample times or video duration. Compressed bytes/quality can vary by device.
Every encoded chunk must match its submitted timestamp; omitted, extra or
reordered frames fail without offering a misleading video.

The job snapshots the current scene and clones mutable geometry/instance buffers,
sharing read-only materials/textures. Live/export use the same registered
scientific callbacks. Image-export rendering, cloned-camera framing, tone/color,
watermark and filename helpers are reused. One temporary renderer serves the job.
Different aspect ratios expand one axis without stretching/cropping.

The playback clock holds without writing session frame/playing values, then
resumes without elapsed-time catch-up. The viewer does not scrub. Scientific
arrays, labels, events, crop, dirty/history state, camera, selection and sidebar
remain unchanged. Configuration is transient UI state.

Limits are two minutes, 7200 frames and 64 MiB of compressed chunks. Unsafe choices
are blocked transparently; scientific content is never silently shortened. Native
encoding is flushed in batches of four and every VideoFrame closes immediately
after submission. Raw frames are not all retained. Compressed chunks remain in
memory until the final Blob is assembled. Large scenes may still exceed device memory.

Cancel, Escape or Close aborts and suppresses incomplete files. Startup/render/
encoding/memory/timeout failures leave the UI usable. Encoders, GPU resources,
cloned geometry, canvases, timers/callbacks and Blob URLs are released on all exits.
Capability probes are bounded and cancellable too.

All processing stays browser-local. No frames, videos, filenames or scientific
data are uploaded, persisted in application storage or added to analytics.
Filenames reuse PNG sanitization, for example `trial_3d_30fps.webm`; fallback is
`je-motion-lab-video.webm`.

References: [WebCodecs](https://www.w3.org/TR/webcodecs/),
[WebM container](https://www.webmproject.org/docs/container/) and
[Matroska timestamps](https://www.matroska.org/technical/notes.html#timestamps).
