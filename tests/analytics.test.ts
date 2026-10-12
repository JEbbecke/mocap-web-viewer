import { afterEach, expect, it, vi } from 'vitest';
import { trackEvent } from '../src/analytics';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it.each(['visit', 'c3d_loaded', 'h5_loaded'] as const)(
  '%s sends only the event type to the existing endpoint',
  async (event) => {
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetch);
    await trackEvent(event);
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      'https://je-motion-analytics.jonasebbecke97.workers.dev/event',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event }),
      },
    );
  },
);

it.each(['http', 'network'] as const)('%s failures resolve without retrying', async (failure) => {
  const fetch = vi.fn();
  if (failure === 'http') fetch.mockResolvedValue({ ok: false, status: 503 });
  else fetch.mockRejectedValue(new Error('Offline'));
  vi.stubGlobal('fetch', fetch);
  vi.spyOn(console, 'debug').mockImplementation(() => {});
  await expect(trackEvent('visit')).resolves.toBeUndefined();
  expect(fetch).toHaveBeenCalledTimes(1);
});
