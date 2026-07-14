import { describe, expect, it } from "vitest";
import { EventBus } from "./event-bus.js";

async function take<T>(it: AsyncIterableIterator<T>, n: number): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < n; i += 1) {
    const { value, done } = await it.next();
    if (done) break;
    out.push(value);
  }
  return out;
}

describe("EventBus", () => {
  it("delivers published values to a subscriber", async () => {
    const bus = new EventBus<number>();
    const sub = bus.subscribe();
    bus.publish(1);
    bus.publish(2);
    expect(await take(sub, 2)).toEqual([1, 2]);
  });

  it("fans out to multiple independent subscribers", async () => {
    const bus = new EventBus<string>();
    const a = bus.subscribe();
    const b = bus.subscribe();
    bus.publish("x");
    expect((await a.next()).value).toBe("x");
    expect((await b.next()).value).toBe("x");
  });

  it("buffers values published before the consumer awaits", async () => {
    const bus = new EventBus<number>();
    const sub = bus.subscribe();
    bus.publish(10);
    bus.publish(20);
    expect((await sub.next()).value).toBe(10);
    expect((await sub.next()).value).toBe(20);
  });

  it("ends the iterator when the bus closes", async () => {
    const bus = new EventBus<number>();
    const sub = bus.subscribe();
    bus.close();
    expect((await sub.next()).done).toBe(true);
  });

  it("a subscriber created after close ends immediately", async () => {
    const bus = new EventBus<number>();
    bus.close();
    expect((await bus.subscribe().next()).done).toBe(true);
  });

  it("return() detaches the subscriber", async () => {
    const bus = new EventBus<number>();
    const sub = bus.subscribe();
    await sub.return?.(undefined as never);
    expect((await sub.next()).done).toBe(true);
  });
});
