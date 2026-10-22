class ClosedCancellationTestScopeError extends Error {
  constructor() { super("The cancellation test scope is closed."); }
}

/** Owns asynchronous work for one cancellation test, including a timed-out body. */
export class CancellationTestScope {
  private closed = false;
  private readonly controllers = new Set<AbortController>();
  private readonly releases = new Set<() => void>();
  private readonly unlinkSignals = new Set<() => void>();
  private readonly pending = new Set<Promise<void>>();
  private readonly assertionFailures: unknown[] = [];
  private readonly lateBodyFailures: unknown[] = [];
  private bodySettlement: Promise<void> = Promise.resolve();
  private closing?: Promise<void>;

  assertOpen(): void {
    if (this.closed) throw new ClosedCancellationTestScopeError();
  }

  controller(signal?: AbortSignal): AbortController {
    this.assertOpen();
    const controller = new AbortController();
    this.controllers.add(controller);
    if (signal) {
      const abort = () => controller.abort(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      this.unlinkSignals.add(() => signal.removeEventListener("abort", abort));
      if (signal.aborted) abort();
    }
    return controller;
  }

  /** A gate reached during shutdown must also be released, rather than orphaned. */
  gate(): { promise: Promise<void>; release: () => void } {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    const release = () => { this.releases.delete(release); resolve(); };
    if (this.closed) release();
    else this.releases.add(release);
    return { promise, release };
  }

  start<T>(operation: () => Promise<T>): Promise<T> {
    this.assertOpen();
    return this.observe(operation());
  }

  /** Expectations create a second promise; retain failures even if the body exits early. */
  assertion<T>(expectation: Promise<T>): Promise<T> {
    return this.observe(expectation, true);
  }

  runBody(body: () => Promise<void>): Promise<void> {
    this.assertOpen();
    const running = Promise.resolve().then(body);
    // Keep this separate: putting teardown or the body in pending can self-await.
    this.bodySettlement = running.then(() => undefined, (error: unknown) => {
      // Vitest already reports pre-close failures. A timed-out body's later cause
      // would otherwise be lost; only our deliberate refusal of late starts is expected.
      if (this.closed && !(error instanceof ClosedCancellationTestScopeError)) this.lateBodyFailures.push(error);
    });
    return running;
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    for (const controller of this.controllers) controller.abort();
    for (const release of this.releases) release();
    for (const unlink of this.unlinkSignals) unlink();
    this.closing = this.drain();
    return this.closing;
  }

  private async drain(): Promise<void> {
    // Abort is only a request. Wait for operations, assertions and body continuations.
    await this.bodySettlement;
    while (this.pending.size) await Promise.all([...this.pending]);
    const failures = [...new Set([...this.assertionFailures, ...this.lateBodyFailures])];
    if (failures.length) {
      throw new AggregateError(failures, "Cancellation test asynchronous work failed.");
    }
  }

  private observe<T>(promise: Promise<T>, assertion = false): Promise<T> {
    const settlement = promise.then(() => undefined, (error: unknown) => {
      if (assertion) this.assertionFailures.push(error);
    }).then(() => { this.pending.delete(settlement); });
    this.pending.add(settlement);
    return promise;
  }
}
