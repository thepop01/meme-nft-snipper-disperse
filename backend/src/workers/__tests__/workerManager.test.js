import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { startAllWorkers, stopAllWorkers, getWorkerStatus } from '../workerManager.js';

describe('Worker Manager', () => {
  beforeEach(() => {
    stopAllWorkers();
  });

  afterEach(() => {
    stopAllWorkers();
  });

  it('initializes and reports health status of all 5 workers', () => {
    startAllWorkers({ autoRun: false });
    const status = getWorkerStatus();
    expect(status.running).toBe(true);
    expect(status.workers.worker1).toBeDefined();
    expect(status.workers.worker2).toBeDefined();
    expect(status.workers.worker3).toBeDefined();
    expect(status.workers.worker4).toBeDefined();
    expect(status.workers.worker5).toBeDefined();
  });

  it('includes endpoint health in status report', () => {
    startAllWorkers({ autoRun: false });
    const status = getWorkerStatus();
    expect(status.endpoints).toBeDefined();
    expect(typeof status.endpoints).toBe('object');
  });

  it('stops all workers and returns running=false', () => {
    startAllWorkers({ autoRun: false });
    expect(getWorkerStatus().running).toBe(true);
    stopAllWorkers();
    expect(getWorkerStatus().running).toBe(false);
  });

  it('does not start duplicate workers if already running', () => {
    startAllWorkers({ autoRun: false });
    const status1 = getWorkerStatus();
    startAllWorkers({ autoRun: false });
    const status2 = getWorkerStatus();
    expect(status1).toEqual(status2);
  });
});
