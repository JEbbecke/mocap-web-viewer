import { useEffect, useRef, useState } from 'react';
import type { Series } from '../motion/types';
import type { ModelRequest } from '../explorer/modelPage';
import { useSession } from '../state/session';

/** Shared full scalar reader; table page offsets never participate in this request. */
export function useModelSeries(model?: Omit<ModelRequest, 'offset'>) {
  const file = useSession((s) => s.sourceFile);
  const key = model ? JSON.stringify(model) : '';
  const buffer = useRef<{ key: string; file: File; series: Series } | null>(null);
  const [, refresh] = useState(0);
  const [failure, setFailure] = useState<{ key: string; error: string } | null>(null);
  useEffect(() => {
    buffer.current = null;
    setFailure(null);
    if (!key) return;
    if (!file) {
      setFailure({ key, error: 'Original H5 file is unavailable.' });
      return;
    }
    let active = true;
    const worker = new Worker(new URL('../workers/explorer.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (event: MessageEvent<{ series?: Series; error?: string }>) => {
      if (!active) return;
      if (event.data.series) {
        buffer.current = { key, file, series: event.data.series };
        refresh((n) => n + 1);
      } else setFailure({ key, error: event.data.error ?? 'Model plot reader failed.' });
      worker.terminate();
    };
    worker.onerror = () => {
      if (active) setFailure({ key, error: 'Model plot reader failed.' });
      worker.terminate();
    };
    worker.postMessage({ file, request: { ...JSON.parse(key), offset: 0 }, plot: true });
    return () => {
      active = false;
      worker.terminate();
      buffer.current = null;
    };
  }, [file, key]);
  return {
    series:
      buffer.current?.key === key && buffer.current.file === file ? buffer.current.series : null,
    error: failure?.key === key ? failure.error : '',
  };
}
