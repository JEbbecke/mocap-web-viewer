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

The new name appears immediately in search, selection, inspector, 3D labels and
plot selectors. Visibility and both plot selections retain their marker indices.
Array indices are stable source-column identities within a recording: renaming
and cropping never reorder marker columns. Numerical arrays, validity, residuals
and quality data are shared unchanged during a rename.

Built-in connections remain attached to the original source columns. Preset
matching uses imported labels retained once per collection; changing the preset
still matches those imported labels. A rename neither rewrites presets nor adds
new links based on the new name. Re-importing an exported recording resolves
presets afresh against its exported names. There are currently no editable custom
connections. Matching H5 rigid-body membership names follow marker renames and
undo/redo. The viewer does not infer anatomical connections from those names.

**Undo / Redo** in the header covers all committed Data-tab renames and event
add/edit/delete. Ctrl/Cmd+Z undoes, Ctrl/Cmd+Shift+Z redoes, and Ctrl+Y also redoes
on Windows. Native input, textarea and contenteditable undo is left alone.
Visibility, camera, plot selection, search and other view settings are excluded.

History keeps up to 100 reversible commands. Commands retain collection/index
and old/new names, or the affected event row and its positions, rather than
recording snapshots. Event source identity and all row metadata survive undo. New edits
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

Export always uses current committed labels and events. C3D rebuilds
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
H5 `EMG` labels unchanged; those can be renamed independently. Mixed label/event history follows
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
