# Python reference audit

Audited 24 September 2026, read-only: sibling `ibo-mocap-visualizer-0.1.1`, sibling `ibo-biomech`, and installed `IBO_env/Lib/site-packages/ibo_biomech`. Actual representative files were inspected with h5py and ezc3d. These private measurements are deliberately excluded from this repository and deployment.

## Architecture and scope

`run_visualizer.py`, package `__main__.py`, and the console script invoke `app.main`. `startup.py` accepts zero or one local file. PyQt5 owns the event loop. `ui/main_window.py` owns the sidebar, file dialogs/drop, timer, GL items, and separate pyqtgraph plot windows. `ui/gl_view.py` distinguishes clicks from camera drags; `render/marker_picking.py` picks the nearest finite projected marker within 10 pixels. Dependencies: numpy, PyQt5, pyqtgraph, PyOpenGL, ibo-biomech >=0.1.7,<0.2. No marker-set configuration or segment/connection implementation exists in this version.

`backends/ibo_backend.py` is the only scientific backend seam. It loads `C3DHandler` or `H5Handler`, constructs `TrialData`, validates shapes/rates/units, and projects frozen DTOs in `core/visualization_data.py`. The GUI sees markers `[marker,xyz,frame]`, scalar analogs per marker frame, and forces/moments/COP `[frame,xyz]`, plus animated geometry. Tests cover shape normalization, interpolation, missing optional streams, picking, and startup. One test still accesses obsolete `plate.corners` instead of `corners_by_frame`.

## Import and timing

C3D uses `ezc3d.c3d(..., extract_forceplat_data=True)`. Marker labels are stripped; coordinates and POINT units/rate are retained. Residuals and camera validity do not reach the GUI. Duplicate marker labels overwrite dictionary entries; analog labels are suffixed. Analog scaling is delegated to ezc3d, with original ANALOG rate and units. There is no special EMG processing.

H5 follows the institute hierarchy documented in H5_FORMAT.md. Marker unit defaults to mm even when a Unit attribute exists; residuals and Type are ignored. Analog unit attributes and Events are not read. Events are not displayed for either format. No timestamps are loaded: time is `frame / rate`, starting at zero. Original frame numbers are discarded by the adapter.

Each analog and force stream is independently linearly interpolated onto marker timestamps; outside its range gives NaN. This is display interpolation, not filtered scientific resampling. Rotations use nearest samples. Static geometry repeats, dynamic geometry is interpolated at the force rate, even when exported at marker rate (a bug).

## Force conventions

C3D force extraction is ezc3d's platform module: global force, surface-centre moment, global COP, free moment Tz, corners and local origin offset. Types 2/4 use six channels (type 4 calibration), type 3 eight transducer channels with optional COP polynomial correction. Rotation uses corner 1 minus corner 2 for local X, corner 1 minus corner 4 for tentative Y, cross products to obtain right-handed axes, and corner centroid for translation. ezc3d negates the entire origin vector when its Z component is positive. Moments are transported to the surface by `M_surface = M_sensor + F × origin`. COP is `(-My/Fz, Mx/Fz, 0)` in that local surface plane, then rotated/translated. No sign flip is applied to the force for visualization.

The sibling and installed ForceData replace NaN force/moment/COP/geometry with zero. The C3D handler puts corners only in metadata; the current adapter reads `location`, whose default is a zero plate. The H5 handler reads geometry, but ignores CoordinateSystem and does not transform forces. ForceData defaults that identifier to 0. The exporter writes CoordinateSystem=0 even though ezc3d's forces/COP are already global. This is a contradictory attribute, not evidence that the samples need rotation.

The renderer draws `COP → COP + force`, numerically 1 position unit/N, without a threshold. Thus mm trials use 1 mm/N but metre trials would use 1 m/N. It plots force moments but does not draw moment vectors. Plate meshes have two triangles; valid right-handed orthonormal rotations yield 50 mm sensor axes. Offset is carried but not used for rendering.

## Scene and interaction

The native scene is Z-up, XY ground, RGB XYZ axes. Initial camera distance is 2000 source units; grid is 20000 wide at 1000 spacing. Markers use physical diameter where the unit is known, otherwise pixel fallback. Selection enlarges and recolours a marker; double click opens XYZ plots. Force/moment/COP and analog plots have synchronized frame cursors. There is no skeleton, gait-event detection, gap editing, or visibility preset system.

Playback starts on load, uses elapsed wall time and true marker rate, polls every 5 ms, skips frames when necessary and loops. Pause/resume retains frame. Scrubbing does not reset the running time origin. No speed setting or loop toggle exists.

## Other functionality and limitations

Desktop exports H5 and TRC through FileConverter; TRC conversion defaults to an X rotation of -90 degrees and metres for OpenSim, which is NOT a viewer convention. MAT and TRC import are inactive. Backend containers have filtering, rotation, unit conversion and cropping utilities, with inconsistent component/sample axis assumptions; these are not UI features. Windows scripts install shortcuts and file associations; they have no browser equivalent.

The web version preserves physical axes and force signs, but uses metres/N/Nm, retains missingness, original rates, residuals and frame origin, fixes the explicitly documented unit and geometry issues, and does not reproduce NaN-to-zero or incorrect geometry defaults. See MIGRATION.md and OPEN_QUESTIONS.md.

Additional validation finding: installed ezc3d 1.7.0 reports a residual of 8192 mm for a synthetic floating point fourth word of 2.0 with scale -0.5; the C3D specification gives 1 mm. For an actual packed word of 32521 at scale -0.13408342, it reports 2436.832 mm rather than 1.20675 mm. These values correspond to reading the IEEE float's raw high 16 bits. The desktop does not expose residuals, so this did not affect its rendering. The web parser follows the published low-byte-after-integer-conversion rule. See VALIDATION.md; this observed discrepancy is deliberately not copied.
