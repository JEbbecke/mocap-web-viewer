"""Generate an entirely synthetic populated schema fixture (no reference values)."""
import base64
import io
import json
from pathlib import Path
import h5py
import numpy as np
import sys

buffer = io.BytesIO()
with h5py.File(buffer, 'w') as f:
    def group(path, **attrs):
        g = f.require_group(path)
        for k, v in attrs.items():
            g.attrs[k] = v
        return g

    def dataset(g, name, values):
        a = np.asarray(values)
        if a.dtype.kind in 'OU':
            g.create_dataset(name, data=a.astype(object), dtype=h5py.string_dtype('utf-8'))
        else:
            g.create_dataset(name, data=a, compression='gzip')

    group('MetaData', Project='Synthetic', BodyMass='unknown')
    group('MetaData/Location', Lat='unknown', Lon='unknown')
    dataset(f['MetaData'], 'Calibration', np.array([3, 4], dtype=np.int16))
    group('CustomFields', Opaque='preserve me')
    group('Trajectories', NumFrames=8, StartFrame=8, EndFrame=15, SamplingFrequency=4.)
    g = group('Trajectories/Labeled', Labels=['A', 'B'], Unit='mm', NumLabeled=2,
              ResidualStatus='NaN means unavailable; negative means invalid')
    dataset(g, 'Data', np.arange(64, dtype=np.float64).reshape(2, 4, 8) + .123456789)
    residuals = np.zeros((2, 8)); residuals[0, 1] = np.nan; residuals[1, 2] = -1
    dataset(g, 'Residuals', residuals)
    dataset(g, 'Time', 2 + np.arange(8) / 4)
    dataset(g, 'Type', np.ones((2, 8), dtype=np.int8))
    dataset(g, 'CameraMasks', (np.arange(48).reshape(2, 3, 8) % 2).astype(bool))
    dataset(g, 'CameraMasksKnown', np.array([True, False]))
    dataset(g, 'Virtual', np.array([False, True]))
    for name in ['Analog', 'EMG']:
        g = group(name, Labels=['Channel'], Channels=np.array([0], dtype=np.int64),
                  Units=['V'], SamplingFrequency=8., NumSamples=16)
        dataset(g, 'Data', np.arange(16, dtype=np.float64).reshape(1, 16))
        dataset(g, 'Time', 2 + np.arange(16) / 8)
    g = group('ForcePlates/0', Name='Plate', SchemaVersion=2, CoordinateSystem=1,
              FreeMomentFrame='global', NumSamples=16, SamplingFrequency=8.,
              unit_force='N', unit_moment='Nmm', unit_position='mm')
    for name in ['Force', 'Moment', 'COP', 'Tz', 'Position']:
        dataset(g, name, np.arange(48, dtype=np.float64).reshape(3, 16) + .25)
    dataset(g, 'Corners', np.arange(192, dtype=np.float64).reshape(3, 4, 16))
    dataset(g, 'Rotation', np.repeat(np.eye(3)[:, :, None], 16, axis=2))
    dataset(g, 'Origin', np.array([[0.], [0.], [-50.]]))
    dataset(g, 'Time', 2 + np.arange(16) / 8)
    group('RigidBodies', SchemaVersion=1)
    g = group('RigidBodies/0', Name='Body', NumSamples=8, Unit='mm')
    dataset(g, 'Position', np.arange(24, dtype=np.float64).reshape(3, 8))
    dataset(g, 'Rotation', np.repeat(np.eye(3)[:, :, None], 8, axis=2))
    dataset(g, 'Markers', ['A', 'B'])
    for name in ['IKResults', 'IDResults']:
        g = group(name, Labels=['time', 'quantity'], Metadata='{}', NumSamples=4)
        times = np.array([1.75, 2.3, 3.6, 4.5])
        dataset(g, 'Data', np.array([times, [4., 5., 6., 7.]]))
        dataset(g, 'Time', times)
    g = group('Events', SchemaVersion=1, Scope='Trial clock; zero-based source point frames; seconds')
    dataset(g, 'Name', ['Late', 'Early', 'Outside'])
    dataset(g, 'Description', ['Unicode: Fuß', ' keep spaces ', ''])
    dataset(g, 'Frame', np.array([13, 9, 20], dtype=np.int64))
    dataset(g, 'Time', np.array([3.25, 2.25, 5.]))

current = '--current' in sys.argv
if current:
    with h5py.File(buffer, 'r+') as f:
        meta = f['MetaData']
        project = meta.create_group('Project')
        for key, value in dict(SubjectID='SYNTHETIC', SubjectGroup='Control', Age='30',
                               BodyHeight='175', BodyMass='70', Sex='unknown',
                               Condition='Baseline', Project='Synthetic', ProjectPI='Example').items():
            project.attrs[key] = value
        info = meta.create_group('FileInfo')
        for key, value in dict(FileCreationLocal='2026-01-01T12:00:00',
                               FileCreationUTC='2026-01-01T11:00:00Z',
                               LastUpdate='2026-01-02', OriginalFiles=['synthetic.c3d'],
                               PathFile='synthetic.c3d').items():
            info.attrs[key] = value
        for key in list(meta.attrs):
            del meta.attrs[key]
        for name, values in [('POINT', ['A', 'B']), ('ANALOG', ['Channel'])]:
            g = meta.create_group(f'C3DParameters/{name}/LABELS')
            g.attrs['value'] = values
            g.attrs['type'] = -1
            g.attrs['description'] = 'Synthetic parameter'
            g.attrs['is_locked'] = False
            g = meta.create_group(f'C3DParameters/{name}/__METADATA__')
            g.attrs['IS_LOCKED'] = True
            g.attrs['DESCRIPTION'] = 'Synthetic group'
        # Boolean vector metadata exercises shape and value preservation beyond scalar locks.
        meta['C3DParameters'].attrs['SyntheticFlags'] = np.array([True, False])
        labeled = f['Trajectories/Labeled']
        for key in ['CameraMasks', 'CameraMasksKnown']:
            del labeled[key]
        for name in ['Analog', 'EMG', 'ForcePlates/0']:
            f[name].attrs['StartFrame'] = 16
            f[name].attrs['EndFrame'] = 31
        f['ForcePlates/0'].attrs['FrameStep'] = 1
        del f['ForcePlates/0'].attrs['SchemaVersion']
        del f['RigidBodies'].attrs['SchemaVersion']
        f['RigidBodies/0'].attrs['StartFrame'] = 0
        f['RigidBodies/0'].attrs['EndFrame'] = 7
        events = f['Events']
        for key in list(events.attrs):
            del events.attrs[key]
        dataset(events, 'Context', ['Left', 'Right', 'General'])
        dataset(events, 'Subject', ['', 'Synthetic', ''])
        dataset(events, 'GenericFlag', np.array([0, 1, 0], dtype=np.int64))
        dataset(events, 'IconID', np.array([2, 3, 4], dtype=np.int64))
        for name in ['IKResults', 'IDResults']:
            times = np.array([0., .2, .5, .75])
            f[name]['Time'][:] = times
            f[name]['Data'][0] = times
        f['IKResults'].attrs['Metadata'] = "{'version': '1', 'nRows': '4', 'nColumns': '2', 'inDegrees': 'yes'}"

root = Path(__file__).resolve().parents[1]
(root / ('tests/fixtures/current-h5.json' if current else 'tests/fixtures/institute-h5.json')).write_text(json.dumps({
    'description': 'Entirely synthetic; generated by scripts/create-h5-fixture.py',
    'base64': base64.b64encode(buffer.getvalue()).decode('ascii'),
}) + '\n', encoding='utf-8')
