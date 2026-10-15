import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cancelImport, openExampleFile, openFile, useSession } from '../src/state/session';

const workers: FakeWorker[] = [];
class FakeWorker {
  onmessage?: (event: { data: unknown }) => void;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    workers.push(this);
  }
}
const fetchMock = vi.fn();
const initialState = useSession.getInitialState();

beforeEach(() => {
  workers.length = 0;
  useSession.setState(initialState, true);
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});
afterEach(() => {
  cancelImport();
  useSession.setState(initialState, true);
  vi.unstubAllGlobals();
});

it('downloads once on demand and imports unchanged bytes through the normal worker', async () => {
  expect(fetchMock).not.toHaveBeenCalled();
  const bytes = new Uint8Array([137, 72, 68, 70]);
  let finish!: (response: Response) => void;
  fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => (finish = resolve)));
  const loading = openExampleFile();
  expect(useSession.getState()).toMatchObject({ busy: true, operation: 'download' });
  await openExampleFile();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, options] = fetchMock.mock.calls[0];
  expect(url).not.toMatch(/^(https?:|data:)/);
  expect(url).toContain('example_data.h5');
  expect(Object.keys(options)).toEqual(['signal']);
  finish(new Response(bytes));
  await loading;
  expect(useSession.getState()).toMatchObject({ busy: true, operation: 'import' });
  expect(workers).toHaveLength(1);
  const file = workers[0].postMessage.mock.calls[0][0] as File;
  expect(file.name).toBe('example_data.h5');
  expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes);
  await openExampleFile();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  fetchMock.mockResolvedValue(new Response('{}'));
  workers[0].onmessage?.({ data: { data: { name: file.name } } });
  expect(useSession.getState()).toMatchObject({ busy: false, sourceFile: file });
  expect(fetchMock.mock.calls.slice(1)).toEqual([
    [
      'https://je-motion-analytics.jonasebbecke97.workers.dev/event',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'h5_loaded' }),
      },
    ],
  ]);
  await openExampleFile();
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it.each(['http', 'network', 'body'] as const)(
  'reports %s failures and permits retry',
  async (kind) => {
    if (kind === 'http') fetchMock.mockResolvedValueOnce(new Response('', { status: 404 }));
    else if (kind === 'network') fetchMock.mockRejectedValueOnce(new Error('Offline'));
    else
      fetchMock.mockResolvedValueOnce({
        ok: true,
        blob: () => Promise.reject(new Error('Interrupted')),
      });
    await openExampleFile();
    expect(useSession.getState()).toMatchObject({ busy: false, data: null });
    expect(useSession.getState().error).toContain('Could not load the example file.');
    expect(workers).toHaveLength(0);
    fetchMock.mockResolvedValueOnce(new Response('retry'));
    await openExampleFile();
    expect(useSession.getState()).toMatchObject({ busy: true, error: null });
    expect(workers).toHaveLength(1);
  },
);

it('uses normal import errors without sending a load event', async () => {
  fetchMock.mockResolvedValueOnce(new Response('invalid H5'));
  await openExampleFile();
  workers[0].onmessage?.({ data: { error: 'Unsupported H5 schema.' } });
  expect(useSession.getState()).toMatchObject({ busy: false, error: 'Unsupported H5 schema.' });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it.each(['cancel', 'local-file'] as const)('a late download cannot override %s', async (action) => {
  let finish!: (response: Response) => void;
  fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => (finish = resolve)));
  const loading = openExampleFile();
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  const local = new File(['local'], 'local.c3d');
  if (action === 'cancel') cancelImport();
  else openFile(local);
  expect(signal.aborted).toBe(true);
  finish(new Response('late demo'));
  await loading;
  expect(workers).toHaveLength(action === 'cancel' ? 0 : 1);
  if (action === 'local-file')
    expect(workers[0].postMessage).toHaveBeenCalledExactlyOnceWith(local);
  expect(useSession.getState().error).toBeNull();
});

it('ignores aborted fetch errors', async () => {
  fetchMock.mockImplementationOnce(
    (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      }),
  );
  const loading = openExampleFile();
  cancelImport();
  await loading;
  expect(useSession.getState()).toMatchObject({ busy: false, error: null, data: null });
});
