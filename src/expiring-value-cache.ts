export type ExpiringValue<T> = {
  value: T;
  expiresAt: number;
};

export class ExpiringValueCache<T> {
  private current: ExpiringValue<T> | undefined;
  private inFlight: Promise<ExpiringValue<T>> | undefined;

  constructor(
    private readonly safetyWindowMs = 60_000,
    private readonly now = (): number => Date.now(),
  ) {}

  async get(load: () => Promise<ExpiringValue<T>>, now?: number): Promise<T> {
    const startedAt = now ?? this.now();
    if (this.current && this.current.expiresAt - this.safetyWindowMs > startedAt) {
      return this.current.value;
    }

    let pending = this.inFlight;
    if (!pending) {
      pending = load();
      this.inFlight = pending;
    }

    try {
      const loaded = await pending;
      const completedAt = now ?? this.now();
      if (!Number.isFinite(loaded.expiresAt) || loaded.expiresAt - this.safetyWindowMs <= completedAt) {
        throw new Error("Loaded value expires inside safety window");
      }
      this.current = loaded;
      return loaded.value;
    } finally {
      if (this.inFlight === pending) this.inFlight = undefined;
    }
  }
}
