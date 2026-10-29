# Data-label editing and undo/redo

In the **Data** tab, double-click a label or choose its pencil, enter the new label,
and choose **Save** or press Enter. **Cancel** or Escape discards the draft.
Renaming is available for markers, analog channels, force platforms, rigid bodies,
EMG channels, IK variables and ID variables. For markers it changes the label for
the whole trajectory, including generated names such
as `*33`. It does not reassign samples, split trajectories, track or fill gaps.

Labels are trimmed, nonempty and unique within their collection (exact,
case-sensitive comparison). Separate collections may share the same name. For all collections,
capitalization is preserved. Control characters are
rejected. C3D limits labels to 255 UTF-8 bytes because its parameter string width
is an unsigned byte. H5 has no application-imposed length limit. Invalid input
shows an inline explanation; names are never silently truncated.

## Marker interaction and keyboard controls

Select a marker in the 3D Viewer or Trial Inspector. Right-clicking a different
3D marker selects it before opening its compact context menu. Empty space, force
platforms, connection lines and timeline events do not open this menu. Escape,
outside clicks, selection changes and file/workspace transitions dismiss it.
Arrow keys navigate the menu; Enter or Space activates an enabled action.
The menu uses a portal and clamps to the browser viewport, including after resize.

Small visible markers also have a 12 CSS-pixel screen-space picking radius around
their current projected centres. Direct sphere hits retain priority; ambiguous
misses, hidden/invalid samples and camera drags preserve the current selection.
This does not enlarge rendered markers or change their coordinates. The Viewer
suppresses the native browser context menu while retaining the marker menu and
right-drag panning; other application areas keep their native context menus.

| Action                                          | Shortcut                   |
| ----------------------------------------------- | -------------------------- |
| Focus camera on selected marker                 | C                          |
| Rename selected marker                          | Ctrl+Shift+U               |
| Delete selected marker trajectory               | Delete                     |
| Fit/reset scene using the existing Reset action | F                          |
| Open selected marker context menu               | Shift+F10                  |
| Play/pause                                      | Space                      |
| Previous/next frame                             | Left/Right                 |
| First/last frame                                | Home/End                   |
| Undo                                            | Ctrl/Cmd+Z                 |
| Redo                                            | Ctrl/Cmd+Shift+Z or Ctrl+Y |

The header **Keyboard shortcuts** reference also lists local Timeline, Explorer
and panel-resizing keys. It is a modal reference: Tab stays inside, Escape closes
it, and application shortcuts are inactive until it closes. Rename uses
Ctrl+Shift+U on all platforms; Cmd is not an alternative for that binding.

Focus uses the exact current valid sample in normalized scene coordinates. The
camera and orbit target translate together, retaining viewing direction and
distance. Orbiting then rotates about that point. The pivot stays at that position
during playback; press C again to update it. Invalid/missing XYZ or residuals leave
the camera and frame untouched. Camera actions require an active 3D Viewer and do
not enter edit history. F restores the existing scene overview without changing
selection or playback.

Rename opens a compact dialog using the same label editor, validation and session
rename/history operation as the Inspector's inline editor. The name is selected
for replacement; Enter saves and Escape cancels. A replaced trial or workspace
cannot keep a stale rename request. The existing scientific/export guarantees
below apply to both interactions.

**Delete marker** removes the entire selected trajectory across all frames, including
its validity, residuals, quality types, camera masks and per-marker flags. It is one
atomic action in the existing history. Ctrl+Z restores the name, samples, quality,
ordering and supported references; Redo deletes it again. Mixed rename/delete history
uses the same stack. The selected marker is cleared after deletion; repeat keydown
events cannot remove successive markers. Other selected datasets, plots and hidden
markers retain their identities. Checkboxes continue to control visibility only.

At least one marker must remain because the current validated recording and export
model requires a trajectory. Deletion is also disabled when an undocumented source
dependency cannot be safely rewritten: ambiguous duplicate-label memberships,
custom segmented POINT metadata, unknown marker reference layouts or unestablished
H5 marker axes/per-marker enum attributes. The disabled item's tooltip identifies
the limitation. Imported coordinates, virtual markers and invalid/occluded samples
are otherwise deletable as complete trajectories. No extra confirmation is required;
Undo restores the deletion. Timeline event deletion keeps its existing confirmation.

Built-in display connections are regenerated from retained marker columns. Supported
rigid-body membership entries are removed and restored by history; independently
stored body poses, model results, analogs, force platforms and events stay unchanged.
Native C3D exports copy remaining point records and analog bytes without requantizing,
update POINT counts/labels/descriptions and retain supported metadata. H5 exports
slice marker axes, update counts/label aliases and memberships, and preserve source
units/types. The original file and provenance snapshot remain unchanged. Existing
cross-format conversion precision/loss reports still apply.

Typing, native text undo, button activation, plot/table/tree navigation and panel
separator keys take priority over application shortcuts. Marker commands are
available in the Viewer/Inspector workspace; Data Explorer keeps its independent
table selections and has no active camera. Browser/OS-reserved combinations can
only work if delivered to the page; Ctrl+Shift+U is the requested binding, with no
F2 alias. Automated browser coverage targets installed Chrome and optionally Edge;
other browser/OS combinations require manual verification.

## Data identity and history

The new name appears immediately in search, selection, inspector, 3D labels and
plot selectors. Visibility and both plot selections retain their marker identities.
Immutable source-column identities survive renaming, deletion and cropping. Current
array positions can shift after deletion; selection and visibility are reconciled
in the same edit transaction, while explicit plot/Explorer IDs use source identities.
Numerical arrays, validity, residuals and quality data are shared unchanged during
a rename. Deletion copies only retained marker columns and stores the removed
trajectory in its history payload.

Built-in connections remain attached to the original source columns. Preset
matching uses imported labels retained once per collection; changing the preset
still matches those imported labels. A rename neither rewrites presets nor adds
new links based on the new name. Re-importing an exported recording resolves
presets afresh against its exported names. There are currently no editable custom
connections. Matching H5 rigid-body membership names follow marker renames and
undo/redo. The viewer does not infer anatomical connections from those names.

**Undo / Redo** in the header covers marker trajectory deletion, committed Data-tab renames and event
add/edit/delete. Ctrl/Cmd+Z undoes, Ctrl/Cmd+Shift+Z redoes, and Ctrl+Y also redoes
on Windows. Native input, textarea and contenteditable undo is left alone.
Visibility, camera, plot selection, search and other view settings are excluded.

History keeps up to 100 reversible commands. Label and event commands retain
identities, names or affected event rows. A deletion additionally retains only the
removed trajectory and quality arrays, with supported membership/view references;
it does not retain a full recording per action. Event source identity and all row metadata survive undo. New edits
after undo discard redo. Revision IDs track the imported clean checkpoint, so
undoing to it clears Modified. If that checkpoint falls outside retained history,
Restore original is still available.

Loading a new recording and Restore original clear history. Failed or cancelled
imports leave the existing recording and history intact. Crop clears history and
establishes a modified baseline, because undoing numerical cuts would require
retaining potentially large arrays; subsequent metadata edits can be undone back
to that baseline. Restore original discards all edits and crops. Export preserves
history and Modified status: preparing an export does not replace the imported
source or confirm a disk save. Edits and history traversal are blocked while an
import or export is running.

Export always uses the retained marker collection, current committed labels and events. C3D rebuilds
`POINT:LABELS`, `LABELS2`, etc., respecting string dimensions and signed record
capacity, growing the parameter region when needed and retaining raw scientific
records and unrelated parameters. For marker renames, institute H5 updates
`Trajectories/Labeled@Labels`, matching rigid-body membership and nested
`MetaData/C3DParameters/POINT/LABELS@value`, with storage that accommodates new
names. Untouched raw labels retain their original spelling. Its hierarchy, samples, residuals, clocks and other metadata retain their
values. Existing [modified-export limits](CROPPING_EXPORT.md) still apply.
The separate H5 `Unlabeled` group is not exposed as editable trajectories; generated
names in the imported Labeled collection and C3D points are editable.

Analog renames keep the source channel index, both plot selections, signal arrays,
units, rates and timestamps. Force-channel mappings and derived forces/COP remain
unchanged. C3D updates `ANALOG:LABELS`, `LABELS2`, etc., with the same byte limits
as marker labels; H5 updates `Analog@Labels` and its matching nested ANALOG label alias. An analog rename leaves separate
H5 `EMG` labels unchanged; those can be renamed independently. Mixed marker-deletion/label/event history follows
the same undo, redo, crop, restore, import and export rules above.

Force platforms and rigid bodies retain their original H5 group paths; renaming
updates the group's `Name` attribute. Body names also update their position-signal
selectors. EMG edits update `EMG@Labels`. IK/ID edits update their source-row entries
in `IKResults@Labels` / `IDResults@Labels`; hidden time rows and numerical datasets
stay unchanged. `Time` is reserved for model time rows and is rejected as a new
IK/ID variable name. If source model labels are missing/misaligned, export creates
a complete label vector using the displayed generated names for unnamed rows.

C3D force-platform names use an optional `FORCE_PLATFORM:LABELS` parameter with
continuation records when needed. JE Motion Lab reads these names back; other readers
may continue to display platform numbers. Source platform indices preserve the
mapping even when unsupported platforms were omitted during import. Calibration,
channels, force/moment/COP samples and group order are unchanged.

Events are the exception to inline renaming: a single Data-tab click pauses
playback, seeks to the event's frame and opens the same editor as a timeline event
click. Event time, name and metadata edits retain the existing validation and
undo/redo behavior. Closing the editor does not create a history action.
