export interface Summary {
  readonly n: number;
  readonly median: number;
  readonly p95: number;
  readonly worst: number;
}

export interface FrameStats {
  push(v: number): void;
  summary(): Summary;
  clear(): void;
  readonly capacity: number;
}

const EMPTY: Summary = { n: 0, median: 0, p95: 0, worst: 0 };

/** Fixed-size ring of the most recent values. Summaries sort a copy. */
export function createFrameStats(capacity: number): FrameStats {
  const buf = new Float64Array(capacity);
  let count = 0;
  let next = 0;
  return {
    capacity,
    push(v) {
      buf[next] = v;
      next = (next + 1) % capacity;
      if (count < capacity) count++;
    },
    summary() {
      if (count === 0) return EMPTY;
      const sorted = Array.from(buf.subarray(0, count)).sort((a, b) => a - b);
      const at = (q: number): number => sorted[Math.min(count - 1, Math.max(0, Math.ceil(q * count) - 1))] as number;
      return { n: count, median: at(0.5), p95: at(0.95), worst: sorted[count - 1] as number };
    },
    clear() {
      count = 0;
      next = 0;
    },
  };
}
