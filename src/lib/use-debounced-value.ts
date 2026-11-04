import { useEffect, useState } from 'react';

/** Debounces a fast-changing value (e.g. a search box) so we only query once typing pauses. */
export function useDebouncedValue<T>(value: T, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}
