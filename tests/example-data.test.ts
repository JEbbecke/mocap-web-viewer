import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as h5 from 'h5wasm/node';
import { parseH5Tree } from '../src/importers/h5/schema';

it('keeps the public demo readable with generic subject and source metadata', async () => {
  await h5.ready;
  const file = new h5.File('reference-data/example_data.h5', 'r');
  try {
    const motion = parseH5Tree(file, 'example_data.h5');
    expect(motion.source.info?.fileTimestamps).toMatchObject({
      created: { status: 'missing' },
      createdUTC: { status: 'missing' },
      modified: { status: 'missing' },
    });
    expect(motion.timeline.frameCount).toBe(394);
    expect(motion.markers.labels).toHaveLength(68);
    expect(motion.analogs).toHaveLength(56);
    expect(motion.forcePlatforms).toHaveLength(3);
    const subjects = file.get('MetaData/C3DParameters/EVENT/SUBJECTS') as h5.Group;
    expect(subjects.attrs.value.value).toEqual(['Test Subject', '', '', 'Test Subject']);
    expect((file.get('Events/Subject') as h5.Dataset).value).toEqual(Array(5).fill('Test Subject'));
    const info = file.get('MetaData/FileInfo') as h5.Group;
    expect(Object.keys(info.attrs).sort()).toEqual(['OriginalFiles', 'PathFile']);
    expect(info.attrs.PathFile.value).toBe('example_data.h5');
    expect(info.attrs.OriginalFiles.value).toEqual(['example_data.h5']);
    const project = file.get('MetaData/Project') as h5.Group;
    for (const [name, attr] of Object.entries(project.attrs)) {
      expect(attr.value, name).toBe(name === 'SubjectGroup' ? 'testgroup' : 'Unknown');
    }
    const location = file.get('MetaData/Location') as h5.Group;
    expect(location.attrs.Lat.value).toBe('Unknown');
    expect(location.attrs.Lon.value).toBe('Unknown');
  } finally {
    file.close();
  }
  // Fresh reconstruction also removes obsolete metadata from HDF5 free space.
  const bytes = readFileSync('reference-data/example_data.h5');
  expect(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(bytes.toString('latin1'))).toBe(false);
  expect(bytes.includes(Buffer.from('test_c3d_events.c3d'))).toBe(false);
});
