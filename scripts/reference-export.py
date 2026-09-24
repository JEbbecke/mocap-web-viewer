"""Read-only local oracle export. Outputs remain in ignored .local, never dist.
Run using an existing Python environment containing numpy, h5py and ezc3d.
"""
import json
import struct
from pathlib import Path
import ezc3d
import numpy as np

root = Path(__file__).resolve().parents[1]
reference = root.parent / 'ibo-biomech'
out = root / '.local'
out.mkdir(exist_ok=True)
trials = []
for name in ['03_PRE_GANG12_01.c3d', 'P01_pre_gait_16_0001.c3d']:
    path = reference / name
    c = ezc3d.c3d(str(path), extract_forceplat_data=True)
    # Independent C3D-spec residual oracle. Installed ezc3d 1.7.0 misreads the
    # float word's raw high 16 bits as residual instead of converting to int.
    raw = path.read_bytes()
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
            packed = struct.unpack_from('<f' if floating else '<h', raw,
                start + frame * frame_bytes + (marker * 4 + 3) * width)[0]
            spec_residuals.append(-1 if packed < 0 else (int(packed) & 255) * abs(point_scale) * .001)
    def arr(value):
        a = np.asarray(value)
        return np.where(np.isfinite(a), a, np.nan).tolist()
    trials.append(dict(path=str(path), name=name,
        labels=c['parameters']['POINT']['LABELS']['value'],
        rate=c['header']['points']['frame_rate'],
        firstFrame=c['header']['points']['first_frame'],
        positions=arr(c['data']['points'][:3].transpose(2, 1, 0).reshape(-1) * .001),
        residuals=spec_residuals,
        ezc3dResiduals=arr(c['data']['meta_points']['residuals'][0].T.reshape(-1) * .001),
        analogs=arr(c['data']['analogs'][0]),
        plates=[dict(force=arr(p['force'].T.reshape(-1)),
                     moment=arr(p['moment'].T.reshape(-1) * .001),
                     cop=arr(p['center_of_pressure'].T.reshape(-1) * .001),
                     freeMoment=arr(p['Tz'].T.reshape(-1) * .001))
                for p in c['data']['platform']]))
# Standard JSON representation for missing samples.
text = json.dumps(trials).replace('NaN', 'null').replace('Infinity', 'null')
(out / 'reference.json').write_text(text)
print('Exported two local ezc3d oracles; no source files modified.')
