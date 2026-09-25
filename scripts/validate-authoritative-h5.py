"""Independent h5py oracle for locally generated JE Motion exports.

Run after npm test (and optionally npm run test:browser). Private results stay
in .local. No participant values or labels are printed or committed.
"""
import hashlib
import json
from pathlib import Path
import h5py
import numpy as np

root = Path(__file__).resolve().parents[1]
source = root / 'reference-data/authoritative_reference.h5'
folder = root / '.local/h5-validation'
report = {'comparisons': {}, 'python_reader': {}}


def same(a, b):
    a, b = np.asarray(a), np.asarray(b)
    if a.shape != b.shape or a.dtype != b.dtype:
        return False
    if a.dtype.kind in 'fc':
        return np.array_equal(a, b, equal_nan=True)
    return np.array_equal(a, b)


with h5py.File(source, 'r') as original:
    paths = []
    original.visit(paths.append)
    clock = original['Trajectories/Labeled/Time'][:]
    rate = float(original['Trajectories'].attrs['SamplingFrequency'])
    start, end = 1, 6
    start_time, end_time = clock[0] + start / rate, clock[0] + end / rate
    event_times = original['Events/Time'][:]
    event_rows = np.flatnonzero((event_times >= start_time) & (event_times < end_time))
    for suffix in ['reconstructed', 'edited', 'cropped']:
        bugs, storage_changes = [], []
        destination = folder / f'authoritative-{suffix}.h5'
        with h5py.File(destination, 'r') as output:
            out_paths = []
            output.visit(out_paths.append)
            if out_paths != paths:
                bugs.append('hierarchy')
            event_order = np.arange(len(event_times))
            expected_events = {key: original['Events'][key][:] for key in original['Events']}
            if suffix == 'edited':
                expected_events['Name'][0] = b'Edited synthetic label'
                expected_events['Description'][0] = b'Edited description'
                expected_events['Time'][0] = clock[0] + .3
                expected_events['Frame'][0] = round((clock[0] + .3) * rate)
                event_order = np.argsort(expected_events['Time'], kind='stable')
            elif suffix == 'cropped':
                event_order = event_rows
            for path in [''] + paths:
                a, b = original[path or '/'], output[path or '/']
                if set(a.attrs) != set(b.attrs):
                    bugs.append(path + '@keys')
                for key in a.attrs:
                    expected = a.attrs[key]
                    if suffix == 'cropped':
                        if path == 'Trajectories':
                            expected = {'NumFrames': end-start,
                                        'StartFrame': original['Trajectories'].attrs['StartFrame']+start,
                                        'EndFrame': original['Trajectories'].attrs['StartFrame']+end-1}.get(key, expected)
                        elif key == 'NumSamples':
                            if 'Time' in a:
                                t = a['Time'][:]
                                expected = np.count_nonzero((t >= start_time-1e-9) & (t < end_time-1e-9))
                            elif path.startswith('RigidBodies/'):
                                expected = end-start
                    if a.attrs.get_id(key).dtype != b.attrs.get_id(key).dtype or not same(np.asarray(expected, dtype=np.asarray(a.attrs[key]).dtype), b.attrs[key]):
                        bugs.append(path + '@' + key)
                if not isinstance(a, h5py.Dataset):
                    continue
                expected = a[()]
                if path.startswith('Events/') and suffix != 'reconstructed':
                    expected = expected_events[path.split('/')[-1]][event_order]
                elif suffix == 'cropped':
                    if path.startswith('Trajectories/Labeled/') and path.split('/')[-1] not in ['CameraMasksKnown', 'Virtual']:
                        expected = expected[..., start:end]
                    elif path.startswith('RigidBodies/') and path.split('/')[-1] != 'Markers':
                        expected = expected[..., start:end]
                    elif path.split('/')[0] in ['Analog','EMG','IKResults','IDResults'] or path.startswith('ForcePlates/') and path.split('/')[-1] != 'Origin':
                        times = a.parent['Time'][:]
                        selected = np.flatnonzero((times >= start_time-1e-9) & (times < end_time-1e-9))
                        expected = expected[..., selected]
                if not same(expected, b[()]):
                    bugs.append(path + ': shape/dtype/value')
                if a.dtype.metadata != b.dtype.metadata:
                    bugs.append(path + ': dtype metadata/encoding')
                if (a.chunks, a.maxshape, a.compression, a.compression_opts) != (b.chunks, b.maxshape, b.compression, b.compression_opts):
                    storage_changes.append(path)
        report['comparisons'][suffix] = {'bugs': bugs, 'expected_storage_changes': storage_changes, 'objects_checked': len(paths)+1}

for suffix in ['unchanged', 'edited', 'added', 'deleted', 'cropped']:
    path = folder / f'authoritative-browser-{suffix}.h5'
    if path.exists():
        with h5py.File(path, 'r') as f:
            report['comparisons']['browser-'+suffix] = {
                'readable': True,
                'marker_frames': f['Trajectories/Labeled/Data'].shape[-1],
                'boolean_type_preserved': all(f['Trajectories/Labeled/'+key].dtype == np.dtype(bool) for key in ['CameraMasks','CameraMasksKnown','Virtual']),
                'events': f['Events/Time'].size,
            }
        if suffix == 'unchanged':
            report['comparisons']['browser-'+suffix]['byte_identical'] = path.read_bytes() == source.read_bytes()

try:
    from ibo_biomech.handlers.h5Handler import H5Handler
    for label, path in [('reference', source), ('edited', folder/'authoritative-edited.h5'), ('cropped', folder/'authoritative-cropped.h5')]:
        try:
            trial = H5Handler(str(path)).load_data()
            report['python_reader'][label] = {'loaded': True, 'markers':len(trial.markers), 'forces':len(trial.forces)}
        except Exception as error:
            # Structural error text only; no values, labels or subject metadata.
            report['python_reader'][label] = {'loaded':False,'error_type':type(error).__name__, 'reason':'Installed reader expects legacy Location/Offset datasets.' if 'Location' in str(error) else 'Reader failed; inspect locally.'}
except ImportError:
    report['python_reader']['available'] = False

report['reference_sha256'] = hashlib.sha256(source.read_bytes()).hexdigest()
(folder/'python-report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
bugs = sum(len(v.get('bugs', [])) for v in report['comparisons'].values())
print(json.dumps({'h5py_comparison_bugs':bugs,'comparisons':len(report['comparisons']),'python_reader':report['python_reader']}))
if bugs:
    raise SystemExit(1)
