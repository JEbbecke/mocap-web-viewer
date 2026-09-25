# Migration map

| Python source                     | Purpose                               | Web equivalent / status                                                           |
| --------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------- |
| startup/app/main_window open_path | Launch and open/drop                  | React local File picker/drop, cancellable Worker; complete                        |
| C3DHandler + ezc3d                | binary points/analog/force extraction | isolated TypeScript importer; validated with ezc3d; Intel/MIPS, force types 2/3/4 |
| H5Handler                         | institute schema                      | h5wasm Worker importer; both observed generations supported                       |
| visualization_data DTO            | backend-neutral UI data               | MotionData typed arrays, SI units and original rates; complete                    |
| _align_to_marker_frames           | time-based display sampling           | shared interpolation without extrapolation; complete                              |
| GLScatterPlotItem                 | markers                               | InstancedMesh; complete                                                           |
| GLLinePlotItem/GLMeshItem         | COP force vectors and plates          | Three buffers/arrows; complete                                                    |
| marker_picking                    | selection                             | instanced raycasting and searchable marker list; complete                         |
| QTimer/slider                     | playback                              | elapsed-time clock, speed and loop controls; complete                             |
| plot windows                      | XYZ/analog/force/moment/COP           | synchronized uPlot; complete                                                      |
| H5/TRC exports                    | scientific export                     | deferred; no editing or export in first viewer                                    |
| none                              | marker connections                    | selectable labelled presets, no inferred joint centres; complete                  |
| ignored Events                    | event display                         | standard C3D and versioned institute H5 events implemented                        |
| installation scripts              | desktop file associations             | static GitHub Pages workflow configured; publication requires a repository        |

Intentional corrections: honor stored units; preserve invalid samples instead of zeroing; carry residual validity; use C3D corners instead of default zero geometry; recognize geometry's independent rate; use a physical GRF display scale; reset playback anchor on scrub. No speculative force sign changes, OpenSim export rotation, or skeleton anatomy is introduced into normalization.
