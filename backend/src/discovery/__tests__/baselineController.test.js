import { describe, expect, it, vi } from 'vitest';
import { manualClock } from '../clock.js';
import { BaselineController } from '../baselineController.js';

describe('BaselineController', () => {
  function make() { const clock = manualClock(0); const onClose = vi.fn(); return { clock, onClose, baseline: new BaselineController({ cfg: { baselineWindowMs: 1000, baselineMinSwaps: 3 }, clock, onClose }) }; }
  it('right-censors on min swaps once', () => {
    const { baseline, onClose } = make(); baseline.open('A'); baseline.recordSwap('A'); baseline.recordSwap('A'); baseline.recordSwap('A'); baseline.recordSwap('A');
    expect(onClose).toHaveBeenCalledTimes(1); expect(onClose.mock.calls[0][0]).toMatchObject({ reason: 'min_swaps', swapsObserved: 3 }); expect(baseline.isOpen('A')).toBe(false);
  });
  it('right-censors slow launches on elapsed window with duration', async () => {
    const { baseline, clock, onClose } = make(); baseline.open('A'); baseline.recordSwap('A'); clock.advance(1000); await baseline.tick();
    expect(onClose.mock.calls[0][0]).toMatchObject({ reason: 'window', swapsObserved: 1, durationMs: 1000 });
  });
});
