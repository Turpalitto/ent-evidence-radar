/** Счётный семафор: не более `limit` одновременных секций; остальные ждут в очереди FIFO. */
export class Semaphore {
  private active = 0;
  private readonly queue: (() => void)[] = [];

  constructor(private readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("Semaphore: limit должен быть ≥ 1");
  }

  get inUse() {
    return this.active;
  }

  get waiting() {
    return this.queue.length;
  }

  acquire(): Promise<() => void> {
    return new Promise((resolve) => {
      const grant = () => {
        this.active++;
        let released = false;
        resolve(() => {
          if (released) return;
          released = true;
          this.active--;
          const next = this.queue.shift();
          if (next) next();
        });
      };
      if (this.active < this.limit) grant();
      else this.queue.push(grant);
    });
  }

  /** Выполнить fn внутри семафора. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }
}
