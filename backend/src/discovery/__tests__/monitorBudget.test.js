import { describe, expect, it } from 'vitest';
import { MonitorBudget } from '../monitorBudget.js';
const cfg = { stageBMinBuys: 2, hotLimit: 1, controlSampleRate: 0.5 };

describe('MonitorBudget', () => {
  it('only promotes after evidence and respects evictable capacity', () => {
    const budget = new MonitorBudget({ cfg, rng: () => 0.9 }); budget.recordBuy('A'); expect(budget.isHot('A')).toBe(false);
    budget.recordBuy('A'); budget.recordBuy('B'); budget.recordBuy('B'); expect(budget.isHot('A')).toBe(true); expect(budget.isHot('B')).toBe(false);
  });
  it('keeps random controls at identical depth outside the hot limit', () => {
    const budget = new MonitorBudget({ cfg, rng: () => 0.1 }); budget.registerLaunch('control');
    expect(budget.isControl('control')).toBe(true); expect(budget.isHot('control')).toBe(true);
  });
  it('makes gate-selected and control tokens structurally eligible at the same buy threshold', () => {
    const gate = new MonitorBudget({ cfg, rng: () => 0.9 });
    const control = new MonitorBudget({ cfg, rng: () => 0.1 }); control.registerLaunch('C');
    gate.recordBuy('A'); control.recordBuy('C');
    expect(gate.isStructuralEligible('A')).toBe(false); expect(control.isStructuralEligible('C')).toBe(false);
    gate.recordBuy('A'); control.recordBuy('C');
    expect(gate.isStructuralEligible('A')).toBe(true); expect(control.isStructuralEligible('C')).toBe(true);
  });
});
