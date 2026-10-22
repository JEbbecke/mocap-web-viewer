import { useLayoutEffect, useState, type RefObject } from 'react';

/** Observe the owning container, including changes that do not resize the window. */
export function useElementSize(ref: RefObject<HTMLElement | null>, enabled = true) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !enabled) return;
    const measure = () => {
      const width = element.clientWidth,
        height = element.clientHeight;
      setSize((previous) =>
        previous.width === width && previous.height === height ? previous : { width, height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, enabled]);
  return size;
}

export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  );
  useLayoutEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);
  return matches;
}
