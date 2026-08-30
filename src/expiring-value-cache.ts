export type ExpiringValue<T> = {
  value: T;
  expiresAt: number;
};

export class ExpiringValueCache<T> {
  private current: ExpiringValue<T> | undefined;
  private inFlight: Promise<ExpiringValue<T>> | undefined;

  constructor(private readonly safetyWindowMs = 60_000) {}

  async get(load: () => Promise<ExpiringValue<T>>, now = Date.now()): Promise<T> {
    if (this.current && this.current.expiresAt - this.safetyWindowMs > now) {
      return this.current.value;
    }

    let pending = this.inFlight;
    if (!pending) {
      pending = load();
      this.inFlight = pending;
    }

    try {
      const loaded = await pending;
      if (!Number.isFinite(loaded.expiresAt) || loaded.expiresAt <= now) {
        throw new Error("Loaded value is already expired");
      }
      this.current = loaded;
      return loaded.value;
    } finally {
      if (this.inFlight === pending) this.inFlight = undefined;
    }
  }
}
