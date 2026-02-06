export function createThrottle<T>(
  intervalMs: number,
  fn: (value: T) => void,
) {
  let pending: T | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (pending !== null) fn(pending);
    pending = null;
    timer = null;
  };

  return {
    push(value: T) {
      pending = value;
      if (timer !== null) return;
      timer = setTimeout(flush, intervalMs);
    },
    flush() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      flush();
    },
  };
}

