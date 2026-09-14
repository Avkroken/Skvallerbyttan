const inFlight = new Map<string, Promise<unknown>>();

export function singleFlight<T>(key: string, work: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;

  const promise = Promise.resolve().then(work);
  inFlight.set(key, promise);

  promise.then(
    () => {
      if (inFlight.get(key) === promise) inFlight.delete(key);
    },
    () => {
      if (inFlight.get(key) === promise) inFlight.delete(key);
    },
  );

  return promise;
}
