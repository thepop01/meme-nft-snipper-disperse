// The only time source for ingestion control logic.
export const systemClock = { now: () => Date.now() };

export function manualClock(startMs = 0) {
  let time = startMs;
  return { now: () => time, advance: (ms) => (time += ms) };
}
