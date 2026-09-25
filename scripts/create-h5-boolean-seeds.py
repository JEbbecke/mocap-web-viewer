"""Build empty, participant-free HDF5 datatype templates for h5wasm 0.10.3.

That library can read/write an existing enum but cannot create one. These eight
optional-field combinations preserve h5py's boolean datatype without patching
HDF5 binaries or changing scientific values. Dimensions grow to the actual file.
"""
import base64
import io
import json
from pathlib import Path
import h5py

seeds = {}
for bits in range(1, 8):
    buffer = io.BytesIO()
    with h5py.File(buffer, 'w') as f:
        group = f.create_group('Trajectories/Labeled')
        for bit, (name, rank) in enumerate([('CameraMasks', 3), ('CameraMasksKnown', 1), ('Virtual', 1)]):
            if bits & (1 << bit):
                group.create_dataset(name, shape=(0,) * rank, maxshape=(None,) * rank,
                                     chunks=(16, 4, 64) if rank == 3 else (64,), dtype=bool,
                                     compression='gzip')
    seeds[str(bits)] = base64.b64encode(buffer.getvalue()).decode('ascii')
root = Path(__file__).resolve().parents[1]
(root / 'src/exporters/h5-boolean-seeds.json').write_text(json.dumps(seeds) + '\n', encoding='utf-8')
