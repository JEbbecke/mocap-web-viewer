"""Read only synthetic files produced by conversion and channel-reuse tests.

Requires numpy, h5py and ezc3d. Prints aggregate checks, never recording values.
Does not change the independent readers or any source file.
"""
import json
from pathlib import Path

import ezc3d
import h5py
import numpy as np

folder = Path(__file__).resolve().parents[1] / '.local' / 'cross-format-validation'
pairs = [
    ('synthetic-from-c3d.h5', 'synthetic-derived.c3d'),
    ('synthetic-tilted.h5', 'synthetic-tilted.c3d'),
    ('synthetic-oblique.h5', 'synthetic-oblique.c3d'),
    ('synthetic-edited.h5', 'synthetic-edited.c3d'),
    ('synthetic-extended.h5', 'synthetic-extended.c3d'),
    ('synthetic-corrected-cop.h5', 'synthetic-corrected-cop.c3d'),
    ('synthetic-surveyed-corners.h5', 'synthetic-surveyed-corners.c3d'),
    ('synthetic-metadata.h5', 'synthetic-metadata.c3d'),
    ('synthetic-native.h5', 'synthetic-native.c3d'),
]


def close(actual, expected, atol=1e-4):
    # Float32 storage introduces rounding, particularly when moments are Nmm.
    np.testing.assert_allclose(actual, expected, rtol=2e-6, atol=atol, equal_nan=True)


checked = {'h5_files': 0, 'c3d_files': 0, 'valid_marker_samples': 0,
           'analog_samples': 0, 'force_samples': 0, 'events': 0,
           'reconstructed_cop_plates': 0}
for h5_name, c3d_name in pairs:
    with h5py.File(folder / h5_name, 'r') as source:
        c3d = ezc3d.c3d(str(folder / c3d_name), extract_forceplat_data=True)
        trajectory = source['Trajectories']
        labeled = trajectory['Labeled']
        assert labeled.attrs['Unit'] == 'mm'
        assert labeled['Data'].dtype == np.dtype('float64')
        points = labeled['Data'][:, :3, :].transpose(1, 0, 2)
        valid = (labeled['Residuals'][:] >= 0) & np.isfinite(points).all(axis=0)
        np.testing.assert_array_equal(c3d['data']['meta_points']['residuals'][0] >= 0, valid)
        close(c3d['data']['points'][:3, :, :][:, valid], points[:, valid])
        assert c3d['parameters']['POINT']['LABELS']['value'] == list(labeled.attrs['Labels'])
        assert c3d['parameters']['POINT']['RATE']['value'][0] == trajectory.attrs['SamplingFrequency']
        start = c3d['parameters']['TRIAL']['ACTUAL_START_FIELD']['value']
        first_frame = (int(start[0]) & 65535) + (int(start[1]) & 65535) * 65536 - 1
        assert first_frame == trajectory.attrs['StartFrame']
        close(labeled['Time'][:], (first_frame + np.arange(points.shape[2])) /
              trajectory.attrs['SamplingFrequency'], atol=1e-10)
        checked['valid_marker_samples'] += int(valid.sum())
        if 'Analog' in source:
            analog = source['Analog']
            count = analog['Data'].shape[0]
            close(c3d['data']['analogs'][0, :count, :], analog['Data'][:])
            assert c3d['parameters']['ANALOG']['LABELS']['value'][:count] == list(analog.attrs['Labels'])
            assert c3d['parameters']['ANALOG']['UNITS']['value'][:count] == list(analog.attrs['Units'])
            checked['analog_samples'] += int(analog['Data'].size)
        for i, plate in enumerate(c3d['data']['platform']):
            p = source[f'ForcePlates/{i}']
            assert p.attrs['unit_force'] == 'N'
            assert p.attrs['unit_moment'] == 'Nmm'
            assert p.attrs['unit_position'] == 'mm'
            for target, original in [('force', 'Force'), ('moment', 'Moment'),
                                     ('center_of_pressure', 'COP'), ('Tz', 'Tz')]:
                expected = p[original][:]
                if h5_name == 'synthetic-corrected-cop.h5' and original in ('COP', 'Tz'):
                    corners = p['Corners'][:, :, 0]
                    center = corners.mean(axis=1)
                    x = corners[:, 0] - corners[:, 1]
                    x /= np.linalg.norm(x)
                    z = np.cross(x, corners[:, 0] - corners[:, 3])
                    z /= np.linalg.norm(z)
                    basis = np.array([x, np.cross(z, x), z])
                    force, moment = basis @ p['Force'][:], basis @ p['Moment'][:]
                    local_cop = np.array([-moment[1] / force[2], moment[0] / force[2],
                                          np.zeros(force.shape[1])])
                    if original == 'COP':
                        expected = center[:, None] + basis.T @ local_cop
                        assert np.linalg.norm(expected - p['COP'][:], axis=0).min() > 10
                        checked['reconstructed_cop_plates'] += 1
                    else:
                        expected = basis.T @ (moment + np.cross(force.T, local_cop.T).T)
                close(plate[target], expected, atol=1e-3 if original == 'COP' else 1e-4)
            close(plate['corners'], p['Corners'][:, :, 0])
            checked['force_samples'] += int(p['Force'].shape[1])
        events = source['Events']
        used = int(c3d['parameters'].get('EVENT', {}).get('USED', {'value': [0]})['value'][0])
        assert used == len(events['Time'])
        if not used:
            checked['h5_files'] += 1
            checked['c3d_files'] += 1
            continue
        for target, original in [('LABELS', 'Name'), ('CONTEXTS', 'Context'),
                                 ('DESCRIPTIONS', 'Description'), ('SUBJECTS', 'Subject')]:
            assert c3d['parameters']['EVENT'][target]['value'] == [s.strip() for s in events[original].asstr()[:]]
        times = np.asarray(c3d['parameters']['EVENT']['TIMES']['value'])
        close(times[0] * 60 + times[1], events['Time'][:], atol=1e-5)
        checked['events'] += used
        checked['h5_files'] += 1
        checked['c3d_files'] += 1

metadata = ezc3d.c3d(str(folder / 'synthetic-metadata.c3d'))['parameters']['JE_METADATA']
assert metadata['VERSION']['value'] == ['1']


def embedded(name):
    chunks = list(metadata[name]['value'])
    segment = 2
    while f'{name}{segment}' in metadata:
        chunks.extend(metadata[f'{name}{segment}']['value'])
        segment += 1
    return json.loads(''.join(chunks))


checked['metadata_fields'] = 0
with h5py.File(folder / 'synthetic-metadata.h5', 'r') as source:
    for group, fields in [
        ('MetaData/Project', {'SubjectID': 'SUBJECT_ID', 'SubjectGroup': 'SUBJECT_GROUP',
                             'Age': 'SUBJECT_AGE', 'Sex': 'SUBJECT_SEX',
                             'BodyHeight': 'SUBJECT_HEIGHT', 'BodyMass': 'SUBJECT_MASS',
                             'Condition': 'SUBJECT_CONDITION', 'Project': 'PROJECT',
                             'ProjectPI': 'PROJECT_PI'}),
        ('MetaData/FileInfo', {'OriginalFiles': 'ORIGINAL_FILES', 'PathFile': 'SOURCE_PATH',
                              'FileCreationLocal': 'CREATED_LOCAL', 'FileCreationUTC': 'CREATED_UTC',
                              'LastUpdate': 'LAST_UPDATED'}),
        ('MetaData/Location', {'Lat': 'LATITUDE', 'Lon': 'LONGITUDE'}),
    ]:
        attrs = source[group].attrs
        for field, parameter in fields.items():
            expected = {'values': [str(v).strip() for v in np.atleast_1d(attrs[field])]}
            if f'{field}Unit' in attrs:
                expected['unit'] = str(attrs[f'{field}Unit'])
            assert embedded(parameter) == expected, parameter
            checked['metadata_fields'] += 1
    assert embedded('COORDINATES') == source['Trajectories'].attrs['GlobalCoordinateSystem']
    assert embedded('CREATED') == source['MetaData/FileInfo'].attrs['FileCreationLocal']
    checked['metadata_fields'] += 2

native = ezc3d.c3d(str(folder / 'synthetic-native.c3d'))
assert list(native['parameters']['FORCE_PLATFORM']['TYPE']['value']) == [2, 3, 4]
assert int(native['parameters']['ANALOG']['USED']['value'][0]) == 20
assert any(native['parameters']['FORCE_PLATFORM']['FPCOPPOLY']['value'].ravel())
checked['reused_force_platforms'] = 3

print(json.dumps({'passed': True, 'independent_readers': ['h5py', 'ezc3d'], **checked}))
