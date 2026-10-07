# Image export

Choose **Export media → Export image…** beside the 3D camera controls, then **Export PNG**.
The image configuration is separate from [video export](VIDEO_EXPORT.md), and
remains available when the browser has no supported video encoder.
This exports the scientific scene, including visible markers, their colors,
connections, marker/plate labels, force vectors, COP, plate geometry, grid and
axes against the current scene background. Sidebars, plots, timeline, viewer
buttons, status overlays and the dialog are excluded. This is separate from
C3D/H5 data export in the header.

| Image resolution           | Output                                                                       |
| -------------------------- | ---------------------------------------------------------------------------- |
| Current viewport (default) | The canvas's current drawing-buffer dimensions, including device pixel ratio |
| 1920 × 1080                | Native Full HD render                                                        |
| 3840 × 2160                | Native 4K render                                                             |

Fixed resolutions re-render the scene rather than upscale the visible canvas.
Camera position, orientation and zoom are preserved. When aspect ratios differ,
the projection expands horizontally or vertically to keep the entire original
framing; additional scene content can appear around it. Nothing is stretched.
The visible viewer is never resized or camera-modified.

**Include JE Motion Lab watermark** defaults to enabled and can be unchecked.
The restrained, translucent “JE Motion Lab / jemolab.com” text sits at the
bottom-right with padding and type scaled to the output resolution. It appears
only in exported images.

Export uses the next completed live frame's exact scene buffers. Playback can
continue while the dialog is open; pause first to select a particular frame.
Cropped timelines and visibility settings use the same viewer updates and
individual signal clocks. Image export does not change MotionData, the Modified
indicator, playback settings or undo/redo history.

Rendering, watermark composition and PNG encoding stay local in the browser.
No image, filename or scientific data is uploaded, and no analytics event is
added. Filenames use the loaded basename, remove unsafe characters and include
the pixel dimensions, for example `trial_3d_3840x2160.png`. Full local paths are
excluded; an unavailable name falls back to `je-motion-lab.png`.

The exporter creates a temporary WebGL renderer for the existing scene and a
cloned camera, then copies its render immediately to a detached 2D canvas and
uses native `toBlob()` PNG encoding. The temporary context is disposed and lost,
canvas buffers are released, and the local Blob URL is revoked after the browser
consumes it. The live renderer keeps its normal buffer lifecycle.

WebGL and browser memory limits can prevent large exports; choose a smaller
resolution if an error appears. Closing, Escape or Cancel aborts pending work
and suppresses the file export. A synchronous GPU render may finish before a
cancel action can be processed. Text sprites retain their existing scene texture
resolution. Transparent backgrounds and DOM capture are outside this feature's scope.

Automated Chrome/Edge smoke checks cover actual PNG exports; Safari and Samsung
Internet need manual image-export checks before release. Native canvas, Blob and
anchor APIs avoid a screenshot dependency; universal compatibility is not claimed.
