"""Independent read-only h5py comparison of intentional local JE Motion Lab exports.

Run JE_VALIDATE_REFERENCE=1 npm test -- tests/current-h5.test.ts first.
No participant values are printed or persisted in the report. The source and the
independent institute reader are never modified. Use --cleanup to remove only
the explicitly named reference exports after comparison.
"""
import argparse
import json
from pathlib import Path
import h5py
import numpy as np

root = Path(__file__).resolve().parents[1]
source = root / 'reference-data/authoritative_reference.h5'
folder = root / '.local/h5-validation'
suffixes = ['reconstructed', 'renamed', 'edited', 'added', 'deleted', 'cropped']
report = {'comparisons': {}, 'python_reader': {}}
parser = argparse.ArgumentParser()
parser.add_argument('--cleanup', action='store_true')
args = parser.parse_args()


def same(a, b):
    a, b = np.asarray(a), np.asarray(b)
    if a.shape != b.shape or a.dtype != b.dtype:
        return False
    if a.dtype.kind in 'fc':
        return np.array_equal(a, b, equal_nan=True)
    return np.array_equal(a, b)


def compare_type(a, b, path, bugs, storage):
    if a.dtype != b.dtype or a.dtype.metadata != b.dtype.metadata:
        bugs.append(path + ': dtype/encoding')
    ta, tb = a.get_type(), b.get_type()
    if ta.equal(tb):
        return
    if (ta.get_class() == h5py.h5t.STRING and tb.get_class() == h5py.h5t.STRING
            and ta.is_variable_str() and tb.is_variable_str()
            and ta.get_cset() == tb.get_cset()):
        storage.append(path + ': unused VLEN string padding')
    else:
        bugs.append(path + ': HDF5 datatype')


with h5py.File(source, 'r') as original:
    paths = []
    original.visit(paths.append)
    clock = original['Trajectories/Labeled/Time'][:]
    rate = float(original['Trajectories'].attrs['SamplingFrequency'])
    start, end = 1, len(clock) - 1
    start_time, end_time = clock[0] + start / rate, clock[0] + end / rate
    original_events = {key: original['Events'][key][:] for key in original['Events']}
    original_labels = original['Trajectories/Labeled'].attrs['Labels']
    for suffix in suffixes:
        bugs, storage, expected_changes = [], [], []
        destination = folder / f'authoritative-{suffix}.h5'
        expected_events = {key: values.copy() for key, values in original_events.items()}
        if suffix == 'edited':
            for key, value in dict(Name=b'Edited synthetic label', Description=b'Edited description',
                                   Context=b'Synthetic context', Subject=b'Synthetic subject',
                                   Time=clock[0]+.1, Frame=round(float(original['Trajectories'].attrs['StartFrame'])+.1*rate)).items():
                expected_events[key][0] = value
            order = np.argsort(expected_events['Time'], kind='stable')
        elif suffix == 'added':
            added = dict(Name=b'Added synthetic label', Description=b'', Context=b'', Subject=b'',
                         Time=clock[0]+.125, Frame=round(float(original['Trajectories'].attrs['StartFrame'])+.125*rate),
                         GenericFlag=0, IconID=0)
            for key in expected_events:
                expected_events[key] = np.concatenate([expected_events[key], np.asarray([added[key]], dtype=expected_events[key].dtype)])
            order = np.argsort(expected_events['Time'], kind='stable')
        elif suffix == 'deleted':
            order = np.arange(1, len(original_events['Time']))
            order = order[np.argsort(expected_events['Time'][order], kind='stable')]
        elif suffix == 'cropped':
            times = expected_events['Time']
            snapped = np.where(np.abs(times-start_time) <= 1e-7*np.maximum(1, np.abs(times)), start_time,
                               np.where(np.abs(times-end_time) <= 1e-7*np.maximum(1, np.abs(times)), end_time, times))
            order = np.flatnonzero((snapped >= start_time) & (snapped < end_time))
        else:
            order = np.arange(len(original_events['Time']))

        with h5py.File(destination, 'r') as output:
            out_paths = []
            output.visit(out_paths.append)
            if out_paths != paths:
                bugs.append('hierarchy')
            for path in [''] + paths:
                a, b = original[path or '/'], output[path or '/']
                if set(a.attrs) != set(b.attrs):
                    bugs.append(path + '@keys')
                for key in a.attrs:
                    expected = a.attrs[key]
                    if suffix == 'renamed':
                        if (path == 'Trajectories/Labeled' and key == 'Labels'
                                or path == 'MetaData/C3DParameters/POINT/LABELS' and key == 'value'):
                            expected = np.asarray(expected).copy()
                            expected[0] = 'Renamed synthetic marker'
                    if suffix == 'cropped':
                        if path == 'Trajectories':
                            expected = dict(NumFrames=end-start,
                                            StartFrame=int(a.attrs['StartFrame'])+start,
                                            EndFrame=int(a.attrs['StartFrame'])+end-1).get(key, expected)
                        elif key in ['NumSamples', 'StartFrame', 'EndFrame'] and isinstance(a, h5py.Group):
                            if path in ['Analog', 'EMG'] or path.startswith('ForcePlates/'):
                                times = a['Time'][:]
                                selected = np.flatnonzero((times >= start_time-1e-9) & (times < end_time-1e-9))
                                stride = int(a.attrs.get('FrameStep', 1))
                                first = int(a.attrs.get('StartFrame', 0)) + (int(selected[0]) if len(selected) else 0)*stride
                                expected = dict(NumSamples=len(selected), StartFrame=first,
                                                EndFrame=first+(len(selected)-1)*stride).get(key, expected)
                            elif path.startswith('RigidBodies/'):
                                first = int(a.attrs.get('StartFrame', 0)) + start
                                expected = dict(NumSamples=end-start, StartFrame=first,
                                                EndFrame=first+end-start-1).get(key, expected)
                    expected = np.asarray(expected, dtype=np.asarray(a.attrs[key]).dtype)
                    compare_type(a.attrs.get_id(key), b.attrs.get_id(key), path+'@'+key, bugs, storage)
                    if not same(expected, b.attrs[key]):
                        bugs.append(path+'@'+key+': value/shape')
                    elif not same(a.attrs[key], b.attrs[key]):
                        expected_changes.append(path+'@'+key)
                if not isinstance(a, h5py.Dataset):
                    continue
                expected = a[()]
                if suffix == 'renamed' and path.startswith('RigidBodies/') and path.endswith('/Markers'):
                    expected = expected.copy()
                    for i, value in enumerate(expected):
                        label = value.decode('utf-8') if isinstance(value, bytes) else value
                        if label == original_labels[0]:
                            expected[i] = b'Renamed synthetic marker'
                if path.startswith('Events/') and suffix in ['edited', 'added', 'deleted', 'cropped']:
                    expected = expected_events[path.split('/')[-1]][order]
                elif suffix == 'cropped':
                    if path.startswith('Trajectories/Labeled/') and path.split('/')[-1] not in ['Virtual', 'CameraMasksKnown']:
                        expected = expected[..., start:end]
                    elif path.startswith('RigidBodies/') and not path.endswith('/Markers'):
                        expected = expected[..., start:end]
                    elif path.split('/')[0] in ['Analog', 'EMG'] or path.startswith('ForcePlates/') and not path.endswith('/Origin'):
                        times = a.parent['Time'][:]
                        selected = np.flatnonzero((times >= start_time-1e-9) & (times < end_time-1e-9))
                        expected = expected[..., selected]
                    # Current IK/ID clocks have no declared trial relationship:
                    # independent derived results and processing metadata stay intact.
                compare_type(a.id, b.id, path, bugs, storage)
                if not same(expected, b[()]):
                    bugs.append(path+': value/shape')
                elif not same(a[()], b[()]):
                    expected_changes.append(path)
                if (a.chunks, a.maxshape, a.compression, a.compression_opts) != (b.chunks, b.maxshape, b.compression, b.compression_opts):
                    storage.append(path+': chunks/maxshape/compression')
        report['comparisons'][suffix] = dict(bugs=bugs, expected_changes=expected_changes,
                                              implementation_details=storage, objects_checked=len(paths)+1)

try:
    from ibo_biomech.handlers.h5Handler import H5Handler
    for suffix, path in [('reference', source)] + [(s, folder/f'authoritative-{s}.h5') for s in ['edited', 'cropped']]:
        try:
            trial = H5Handler(str(path)).load_data()
            report['python_reader'][suffix] = dict(loaded=True)
        except Exception as error:
            report['python_reader'][suffix] = dict(loaded=False, error_type=type(error).__name__,
                reason='Installed reader expects legacy Location/Offset.' if 'Location' in str(error) else 'Independent reader failed; no private details logged.')
except ImportError:
    report['python_reader']['available'] = False

(folder/'python-report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
bugs = sum(len(result['bugs']) for result in report['comparisons'].values())
print(json.dumps(dict(h5py_comparison_bugs=bugs, comparisons=len(report['comparisons']),
                      python_reader=report['python_reader'])))
if args.cleanup:
    for suffix in suffixes:
        path = (folder/f'authoritative-{suffix}.h5').resolve()
        if path.parent != folder.resolve():
            raise RuntimeError('Cleanup path is outside the intended validation directory')
        path.unlink()
if bugs:
    raise SystemExit(1)
