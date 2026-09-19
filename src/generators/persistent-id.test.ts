import { beforeEach, describe, expect, it } from "vitest";
import { getNextPersistentId, recomputeNextPersistentId } from "./persistent-id";

describe("getNextPersistentId", () => {
  beforeEach(() => {
    globalThis.pack = {} as any;
  });

  it("starts at 1 on a fresh pack with no counter yet", () => {
    expect(getNextPersistentId()).toBe(1);
  });

  it("increments on every call, never reusing a value", () => {
    expect(getNextPersistentId()).toBe(1);
    expect(getNextPersistentId()).toBe(2);
    expect(getNextPersistentId()).toBe(3);
  });
});

describe("recomputeNextPersistentId", () => {
  beforeEach(() => {
    globalThis.pack = {} as any;
  });

  it("sets the counter to the highest persistentId found across states and provinces", () => {
    globalThis.pack.states = [{ i: 0 } as any, { i: 1, persistentId: 3 } as any, { i: 2, persistentId: 7 } as any];
    globalThis.pack.provinces = [{ i: 0 } as any, { i: 1, persistentId: 5 } as any];

    recomputeNextPersistentId();

    expect(globalThis.pack.nextPersistentId).toBe(7);
    expect(getNextPersistentId()).toBe(8); // the very next id must not collide with any loaded entity
  });

  it("also scans every historical era snapshot's states and provinces, not just the live ones", () => {
    globalThis.pack.states = [{ i: 0 } as any, { i: 1, persistentId: 2 } as any];
    globalThis.pack.provinces = [];
    globalThis.pack.eras = [
      {
        year: 1000,
        states: [{ i: 1, persistentId: 2 } as any],
        provinces: [{ i: 1, persistentId: 40 } as any] // a province that existed in the past but not now
      },
      {
        year: 1100,
        states: [{ i: 1, persistentId: 2 } as any, { i: 2, persistentId: 30 } as any], // a state that later died
        provinces: []
      }
    ] as any;

    recomputeNextPersistentId();

    expect(globalThis.pack.nextPersistentId).toBe(40);
  });

  it("resets to 0 when nothing loaded has a persistentId (e.g. a save from before the feature existed)", () => {
    globalThis.pack.states = [{ i: 0 } as any, { i: 1 } as any];
    globalThis.pack.provinces = [{ i: 0 } as any];

    recomputeNextPersistentId();

    expect(globalThis.pack.nextPersistentId).toBe(0);
    expect(getNextPersistentId()).toBe(1);
  });

  it("tolerates missing states/provinces/eras entirely", () => {
    recomputeNextPersistentId();
    expect(globalThis.pack.nextPersistentId).toBe(0);
  });
});
