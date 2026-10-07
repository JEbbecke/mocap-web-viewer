"""Read-only local oracle export. Outputs remain in ignored .local, never dist.
Run using an existing Python environment containing numpy, h5py and ezc3d.
"""
import argparse
import json
import struct
from pathlib import Path
import ezc3d
import numpy as np

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('files', nargs='*', type=Path, help='Local C3D inputs, opened read-only')
parser.add_argument('--manifest', type=Path, help='Ignored JSON array of local C3D paths')
args = parser.parse_args()
paths = args.files
if args.manifest:
    paths += [Path(value) for value in json.loads(args.manifest.read_text(encoding='utf-8'))]
if not paths:
    parser.error('Supply C3D paths or --manifest .local/reference-inputs.json')
out = root / '.local'
out.mkdir(exist_ok=True)
trials = []
for path in paths:
    path = path.resolve()
    name = 'local.c3d'
    c = ezc3d.c3d(str(path), extract_forceplat_data=True)
    # Independent C3D-spec residual oracle. Installed ezc3d 1.7.0 misreads the
    # float word's raw high 16 bits as residual instead of converting to int.
    raw = path.read_bytes()
    parameter_start = (raw[0] - 1) * 512
    processor = raw[parameter_start + 3]
    if processor not in (84, 86):
        raise ValueError('Independent residual decoding supports Intel/MIPS C3D only')
    byte_order = '<' if processor == 84 else '>'
    point_unit = str(c['parameters']['POINT']['UNITS']['value'][0]).strip().lower()
    metres_per_unit = {'mm': .001, 'cm': .01, 'm': 1}.get(point_unit)
    if metres_per_unit is None:
        raise ValueError('Independent oracle requires declared mm/cm/m POINT units')
    start = (int(c['parameters']['POINT']['DATA_START']['value'][0]) - 1) * 512
    frames = c['data']['points'].shape[2]
    markers = c['data']['points'].shape[1]
    analogs = c['data']['analogs'].shape[1]
    subframes = int(c['parameters']['ANALOG']['RATE']['value'][0] / c['parameters']['POINT']['RATE']['value'][0])
    point_scale = float(c['parameters']['POINT']['SCALE']['value'][0])
    floating = point_scale < 0
    width = 4 if floating else 2
    frame_bytes = (markers * 4 + analogs * subframes) * width
    spec_residuals = []
    for frame in range(frames):
        for marker in range(markers):
            packed = struct.unpack_from(byte_order + ('f' if floating else 'h'), raw,
                start + frame * frame_bytes + (marker * 4 + 3) * width)[0]
            spec_residuals.append(-1 if packed < 0 else (int(packed) & 255) * abs(point_scale) * metres_per_unit)
    def arr(value):
        a = np.asarray(value)
        return np.where(np.isfinite(a), a, np.nan).tolist()
    trials.append(dict(path=str(path), name=name,
        labels=c['parameters']['POINT']['LABELS']['value'],
        rate=c['header']['points']['frame_rate'],
        firstFrame=c['header']['points']['first_frame'],
        positions=arr(c['data']['points'][:3].transpose(2, 1, 0).reshape(-1) * metres_per_unit),
        residuals=spec_residuals,
        ezc3dResiduals=arr(c['data']['meta_points']['residuals'][0].T.reshape(-1) * metres_per_unit),
        analogs=arr(c['data']['analogs'][0]),
        plates=[dict(force=arr(p['force'].T.reshape(-1)),
                     moment=arr(p['moment'].T.reshape(-1) * metres_per_unit),
                     cop=arr(p['center_of_pressure'].T.reshape(-1) * metres_per_unit),
                     freeMoment=arr(p['Tz'].T.reshape(-1) * metres_per_unit))
                for p in c['data']['platform']]))
# Standard JSON representation for missing samples.
text = json.dumps(trials).replace('NaN', 'null').replace('Infinity', 'null')
(out / 'reference.json').write_text(text)
print(f'Exported {len(trials)} local ezc3d oracles; no source files modified.')
