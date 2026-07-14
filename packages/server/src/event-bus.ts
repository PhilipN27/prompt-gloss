// A minimal multi-consumer async event bus. Each `subscribe()` returns an
// independent async iterator; `publish()` fans out to all live subscribers.
// Used to relay agent events to any number of SSE clients.

export class EventBus<T> {
  private readonly queues = new Set<{
    push: (v: T) => void;
    end: () => void;
  }>();
  private closed = false;

  publish(value: T): void {
    for (const q of this.queues) q.push(value);
  }

  close(): void {
    this.closed = true;
    for (const q of this.queues) q.end();
    this.queues.clear();
  }

  subscribe(): AsyncIterableIterator<T> {
    const buffer: T[] = [];
    let resolveNext: ((r: IteratorResult<T>) => void) | null = null;
    let ended = false;

    const handle = {
      push: (v: T) => {
        if (resolveNext) {
          resolveNext({ value: v, done: false });
          resolveNext = null;
        } else {
          buffer.push(v);
        }
      },
      end: () => {
        ended = true;
        if (resolveNext) {
          resolveNext({ value: undefined, done: true });
          resolveNext = null;
        }
      }
    };

    if (this.closed) {
      ended = true;
    } else {
      this.queues.add(handle);
    }

    const iterator: AsyncIterableIterator<T> = {
      next: (): Promise<IteratorResult<T>> => {
        if (buffer.length > 0) {
          return Promise.resolve({ value: buffer.shift()!, done: false });
        }
        if (ended) {
          return Promise.resolve({ value: undefined, done: true });
        }
        return new Promise<IteratorResult<T>>((resolve) => {
          resolveNext = resolve;
        });
      },
      return: (): Promise<IteratorResult<T>> => {
        this.queues.delete(handle);
        ended = true;
        return Promise.resolve({ value: undefined, done: true });
      },
      [Symbol.asyncIterator](): AsyncIterableIterator<T> {
        return iterator;
      }
    };
    return iterator;
  }
}
