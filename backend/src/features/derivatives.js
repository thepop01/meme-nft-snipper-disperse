export class DerivativeTracker {
  constructor(alpha = 0.3) { this.a = alpha; this.level = null; this.vel = 0; this.acc = 0; }

  update(x, dtMs) {
    if (x == null || !Number.isFinite(x) || !Number.isFinite(dtMs) || dtMs <= 0) return this.state();
    const dtMin = dtMs / 60_000;
    if (this.level == null || this.level === 0) { this.level = x; return this.state(); }
    const rawVelocity = ((x - this.level) / this.level) / dtMin;
    const velocity = this.a * rawVelocity + (1 - this.a) * this.vel;
    const rawAcceleration = (velocity - this.vel) / dtMin;
    this.acc = this.a * rawAcceleration + (1 - this.a) * this.acc;
    this.vel = velocity;
    this.level = this.a * x + (1 - this.a) * this.level;
    return this.state();
  }

  state() { return { level: this.level, velocity: this.vel, acceleration: this.acc }; }
}
