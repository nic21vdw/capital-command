import { expect, it } from "vitest";
import { CancellationTestScope } from "./cancellation-test-scope";

it.each([false, true])("drains an early failed body's operation and assertion before reset (unexpected resolution: %s)", async (unexpectedResolution) => {
  const scope = new CancellationTestScope();
  const foreign = new CancellationTestScope();
  const controller = scope.controller(), foreignController = foreign.controller();
  const gate = scope.gate(), foreignGate = foreign.gate();
  let acknowledgeClose!: () => void;
  const closeAcknowledgment = new Promise<void>((resolve) => { acknowledgeClose = resolve; });
  let gateReleased = false, operationSettled = false, assertionSettled = false, reset = false;
  const stopped = new Error("controlled operation stopped");
  let running!: Promise<void>;
  let assertion!: Promise<void>;
  const body = scope.runBody(async () => {
    running = scope.start(async () => {
      await gate.promise; gateReleased = true;
      await closeAcknowledgment;
      operationSettled = true;
      if (!unexpectedResolution) throw stopped;
    });
    assertion = scope.assertion(expect(running).rejects.toBe(stopped));
    void assertion.then(() => { assertionSettled = true; }, () => { assertionSettled = true; });
    throw new Error("body failed before awaiting its assertion");
  });
  await expect(body).rejects.toThrow("body failed before awaiting its assertion");

  const teardown = (async () => {
    try { await scope.close(); }
    finally { reset = true; }
  })();
  // Attach the rejection observer before allowing the controlled operation to finish.
  const result = teardown.then(() => undefined, (error: unknown) => error);
  await Promise.resolve();
  expect(controller.signal.aborted).toBe(true);
  expect(gateReleased).toBe(true);
  expect(operationSettled).toBe(false); expect(assertionSettled).toBe(false); expect(reset).toBe(false);
  expect(() => scope.start(async () => undefined)).toThrow("scope is closed");
  expect(() => scope.controller()).toThrow("scope is closed");
  expect(foreignController.signal.aborted).toBe(false);
  let foreignReleased = false;
  void foreignGate.promise.then(() => { foreignReleased = true; });
  await Promise.resolve(); expect(foreignReleased).toBe(false);

  acknowledgeClose();
  const failure = await result;
  expect(operationSettled).toBe(true); expect(assertionSettled).toBe(true); expect(reset).toBe(true);
  if (unexpectedResolution) {
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toHaveLength(1);
    expect((failure as AggregateError).errors[0].message).toMatch(/resolved.*instead of rejecting/);
  } else expect(failure).toBeUndefined();
  // Late gates are released too, while the other scope remains independently usable.
  await scope.gate().promise;
  await foreign.start(async () => undefined);
  await foreign.close(); expect(foreignReleased).toBe(true);
});

it("drains a body suspended at timeout and refuses its second fixture start", async () => {
  const scope = new CancellationTestScope();
  const external = new AbortController(), owned = scope.controller(external.signal);
  const gate = scope.gate(); let lateStart = false;
  const body = scope.runBody(async () => {
    await scope.start(() => gate.promise);
    await scope.start(async () => { lateStart = true; });
  });
  const bodyFailure = expect(body).rejects.toThrow("scope is closed");
  await Promise.resolve();
  external.abort(); expect(owned.signal.aborted).toBe(true);
  await scope.close();
  await bodyFailure;
  expect(lateStart).toBe(false);
});

it("retains a direct body failure raised after teardown starts", async () => {
  const scope = new CancellationTestScope(), gate = scope.gate();
  const cause = new Error("late body assertion failure");
  const body = scope.runBody(async () => {
    await scope.start(() => gate.promise);
    throw cause;
  });
  const bodyFailure = body.then(() => undefined, (error: unknown) => error);
  await Promise.resolve();
  const failure = await scope.close().then(() => undefined, (error: unknown) => error);
  expect(await bodyFailure).toBe(cause);
  expect(failure).toBeInstanceOf(AggregateError);
  expect((failure as AggregateError).errors).toEqual([cause]);
});
