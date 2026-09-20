import { runOrderedCleanup } from "../runtime-process.mjs";

/** Own source callbacks and finalization through physical settlement. */
export function createSourceGate(register, registerAfter, cleanups) {
  let active, completion, finalization;
  let closed = false;
  let listeners = 0;
  const failures = new Set();
  const first = () => failures.values().next().value;
  const stopped = () => {
    if (failures.size || closed) throw failures.size ? first() : new Error("source gate closed");
  };
  async function root(name, callback, phase) {
    try {
      await register(name, { timeout: 300_000 }, (t) => {
        const abort = () => phase.issues.add(t.signal.reason);
        t.signal.addEventListener("abort", abort, { once: true });
        listeners++;
        if (t.signal.aborted) abort();
        phase.physical = Promise.resolve()
          .then(() => callback(t))
          .catch((error) => {
            phase.issues.add(error);
            throw error;
          })
          .finally(() => {
            t.signal.removeEventListener("abort", abort);
            listeners--;
          });
        return phase.physical;
      });
    } catch (error) {
      phase.issues.add(error);
    }
    if (!phase.physical) phase.issues.add(new Error(`${name}: callback did not start`));
    await phase.physical?.catch(() => undefined);
  }
  const finish = () =>
    (completion ??= (async () => {
      closed = true;
      await active?.physical?.catch(() => undefined);
      try {
        await runOrderedCleanup("source cleanup", cleanups);
      } catch (error) {
        throw new AggregateError([...failures, error], "source cleanup failed", { cause: error });
      }
    })());
  const finalize = () =>
    (finalization ??= (async () => {
      closed = true;
      const phase = { issues: new Set() };
      await root("cleanup official sources", finish, phase);
      if (!phase.physical) await finish().catch((error) => phase.issues.add(error));
      if (phase.issues.size || failures.size > 1)
        throw new AggregateError([...failures, ...phase.issues], "source finalization failed", {
          cause: phase.issues.size ? phase.issues.values().next().value : first(),
        });
    })());
  registerAfter(finish, { timeout: 300_000 });
  return {
    finish,
    finalize,
    snapshot: () => ({
      active: Number(Boolean(active?.physical)),
      busy: Boolean(active),
      listeners,
      closed,
    }),
    async run(callback) {
      try {
        return await callback();
      } catch (error) {
        failures.add(error);
        throw error;
      } finally {
        await finalize();
      }
    },
    async test(name, callback) {
      stopped();
      if (active) throw new Error("concurrent source operation");
      const phase = (active = { issues: failures });
      try {
        await root(
          name,
          (t) => {
            stopped();
            return callback(t);
          },
          phase,
        );
        if (failures.size) throw first();
        return await phase.physical;
      } finally {
        active = undefined;
      }
    },
  };
}
