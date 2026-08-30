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

  async get(load: () => Promise<ExpiringValue<T>>): Promise<T> {
    if (this.current && this.current.expiresAt - this.safetyWindowMs > this.now()) {
      return this.current.value;
    }
    return this.load(load);
  }

  async getFresh(load: () => Promise<ExpiringValue<T>>): Promise<T> {
    return this.load(load);
  }

  invalidate(value: T): void {
    if (this.current && Object.is(this.current.value, value)) this.current = undefined;
  }

  private async load(load: () => Promise<ExpiringValue<T>>): Promise<T> {
    let pending = this.inFlight;
    if (!pending) {
      pending = load();
      this.inFlight = pending;
    }

    try {
      const loaded = await pending;
      if (!Number.isFinite(loaded.expiresAt) || loaded.expiresAt - this.safetyWindowMs <= this.now()) {
        throw new Error("Loaded value expires inside safety window");
      }
      this.current = loaded;
      return loaded.value;
    } finally {
      if (this.inFlight === pending) this.inFlight = undefined;
    }
  }
}
