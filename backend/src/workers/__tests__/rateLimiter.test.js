import { describe, it, expect, beforeEach, vi } from 'vitest';
import { executeWithThrottle, getEndpointHealth, resetRateLimiter } from '../rateLimiter.js';

describe('rateLimiter & Cloudflare Circuit Breaker', () => {
  beforeEach(() => {
    resetRateLimiter();
  });

  it('executes successful request and tracks healthy status', async () => {
    const result = await executeWithThrottle('dexscreener', async () => 'ok');
    expect(result).toBe('ok');
    const health = getEndpointHealth();
    expect(health.dexscreener.status).toBe('healthy');
    expect(health.dexscreener.successCount).toBe(1);
    expect(health.dexscreener.failureCount).toBe(0);
    expect(health.dexscreener.consecutiveErrors).toBe(0);
    expect(health.dexscreener.currentDelayMs).toBe(1000);
  });

  it('decrements currentDelayMs towards baseDelayMs on success', async () => {
    vi.useFakeTimers();
    try {
      // Cause an error to increase currentDelayMs
      try {
        await executeWithThrottle('dexscreener', async () => {
          const err = new Error('Generic error');
          err.status = 500;
          throw err;
        });
      } catch (_) {}

      const healthAfterErr = getEndpointHealth();
      expect(healthAfterErr.dexscreener.currentDelayMs).toBe(2000);

      vi.advanceTimersByTime(2100);

      // Now execute a successful request
      await executeWithThrottle('dexscreener', async () => 'recovered');
      const healthAfterSuccess = getEndpointHealth();
      expect(healthAfterSuccess.dexscreener.currentDelayMs).toBe(1900);
      expect(healthAfterSuccess.dexscreener.status).toBe('healthy');
      expect(healthAfterSuccess.dexscreener.consecutiveErrors).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('marks endpoint as degraded on standard errors before threshold', async () => {
    const err = new Error('Server error');
    err.status = 500;

    await expect(
      executeWithThrottle('geckoterminal', async () => { throw err; })
    ).rejects.toThrow('Server error');

    const health = getEndpointHealth();
    expect(health.geckoterminal.status).toBe('degraded');
    expect(health.geckoterminal.consecutiveErrors).toBe(1);
    expect(health.geckoterminal.failureCount).toBe(1);
    expect(health.geckoterminal.currentDelayMs).toBe(3000); // 1500 * 2
  });

  it('backs off delay on 429 and enters cooling_down on consecutive errors', async () => {
    const err429 = new Error('Too Many Requests (429)');
    err429.status = 429;

    for (let i = 0; i < 3; i++) {
      await expect(
        executeWithThrottle('gmgn', async () => { throw err429; })
      ).rejects.toThrow();
    }

    const health = getEndpointHealth();
    expect(health.gmgn.status).toBe('cooling_down');
    expect(health.gmgn.currentDelayMs).toBeGreaterThan(1500);
    expect(health.gmgn.failureCount).toBe(3);
  });

  it('backs off delay on 403 and enters cooling_down immediately', async () => {
    const err403 = new Error('Forbidden Cloudflare Challenge');
    err403.status = 403;

    await expect(
      executeWithThrottle('dexscreener', async () => { throw err403; })
    ).rejects.toThrow();

    const health = getEndpointHealth();
    expect(health.dexscreener.status).toBe('cooling_down');
    expect(health.dexscreener.coolingUntil).toBeGreaterThan(Date.now());
  });

  it('enters cooling_down when reaching 3 consecutive non-rate-limit errors', async () => {
    vi.useFakeTimers();
    try {
      const err500 = new Error('Internal Server Error');
      err500.status = 500;

      // Call 1
      await expect(
        executeWithThrottle('default', async () => { throw err500; })
      ).rejects.toThrow();

      // Fast-forward past the throttled delay
      vi.advanceTimersByTime(3100);

      // Call 2
      await expect(
        executeWithThrottle('default', async () => { throw err500; })
      ).rejects.toThrow();

      // Fast-forward past the doubled delay
      vi.advanceTimersByTime(6100);

      // Call 3
      await expect(
        executeWithThrottle('default', async () => { throw err500; })
      ).rejects.toThrow();

      const health = getEndpointHealth();
      expect(health.default.status).toBe('cooling_down');
      expect(health.default.consecutiveErrors).toBe(3);
      expect(health.default.failureCount).toBe(3);
      expect(health.default.coolingUntil).toBeGreaterThan(Date.now());
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects immediately when endpoint is in cooldown', async () => {
    const err429 = new Error('Rate limited');
    err429.status = 429;

    await expect(
      executeWithThrottle('gmgn', async () => { throw err429; })
    ).rejects.toThrow();

    await expect(
      executeWithThrottle('gmgn', async () => 'should not run')
    ).rejects.toThrow(/cooling down/i);
  });

  it('throttles calls to enforce currentDelayMs between invocations', async () => {
    let callCount = 0;
    const timestamps = [];

    const fn = async () => {
      timestamps.push(Date.now());
      callCount++;
      return callCount;
    };

    // Use dexscreener with small baseDelayMs artificially simulated
    const start = Date.now();
    await executeWithThrottle('dexscreener', fn);
    await executeWithThrottle('dexscreener', fn);

    expect(callCount).toBe(2);
    expect(timestamps[1] - timestamps[0]).toBeGreaterThanOrEqual(950); // Allowing slight timing jitter
  });

  it('resets all endpoints when resetRateLimiter is called', async () => {
    await executeWithThrottle('dexscreener', async () => 'ok');
    expect(Object.keys(getEndpointHealth())).toContain('dexscreener');

    resetRateLimiter();
    expect(Object.keys(getEndpointHealth())).toHaveLength(0);
  });
});
