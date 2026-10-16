import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { runBoundedCommand } from "../runtime-process.mjs";
import { sha256 } from "./prepare-harness.mjs";
import { createSourceGate } from "./source-gate-lifecycle.mjs";
import { registerSourceCases, runSourceGate } from "./prepared-source.test.mjs";

const marker = "SOURCE_LIFECYCLE_UNIT:";
const source = path.join(import.meta.dirname, "prepare-harness.mjs");
const identity = {
  series: { patches: [{ file: "first.patch" }], upstream: "UNIT" },
  trees: { baseline: "baseline", candidate: "candidate" },
  sources: { a: "original", b: "original", c: "original" },
};
const collect = async (prepared) => {
  const cases = [];
  await registerSourceCases({ test: (name, callback) => cases.push([name, callback]) }, prepared);
  return cases;
};
const missing = "rejects missing identity.json";
const initial = "fresh official sources readmit without writes";
const terminal = "cleanup official sources";
const settled = (promise) =>
  promise.then(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, error }),
  );
const causes = (error) => {
  const values = new Set([error]);
  for (const value of values)
    if (value instanceof AggregateError) for (const child of value.errors) values.add(child);
  return values;
};
const idle = (gate) =>
  assert.deepEqual(gate.snapshot(), { active: 0, busy: false, listeners: 0, closed: true });

async function sourceUnit(root, mode) {
  const prefix = path.join(root, "fixture");
  const work = path.join(root, "work");
  const nodeBin = path.join(prefix, "bin/node");
  const launcher = path.join(prefix, "lib/node_modules/corepack/dist/pnpm.js");
  const pnpm = path.join(work, "private/package-manager/corepack/v1/pnpm/11.7.0/bin/pnpm.cjs");
  const receiptFile = path.join(work, "identity.json");
  const entered = Promise.withResolvers();
  const hookEntered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const controller = new globalThis.AbortController();
  const operationError = new Error(`UNIT ${mode} operation`);
  const disposalError = new Error("UNIT cleanup failure");
  const umask = process.umask();
  const events = [];
  const names = [];
  let cleanup, physical, hookOptions, cleanupError, receipt, receiptMode, targetSignal;
  let pendingHooks = 0;
  let held = 0;
  let premature = false;
  let hashes = 0;
  let lastOperation;
  const native = mode === "success";
  const cancel = ["initial", "mutation"].includes(mode);
  const target = mode === "mutation" ? missing : initial;
  const write = async (file, bytes) => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, bytes, { flag: "wx", mode: 0o600 });
  };
  const registration = {
    registerAfter: (fn, options) => {
      cleanup = fn;
      hookOptions = options;
      assert.equal(options.timeout, 300_000);
    },
    register: (name, options, callback) => {
      names.push(name);
      assert.equal(options.timeout, 300_000);
      const signal = name === terminal ? undefined : controller.signal;
      return test(`UNIT ${name}`, { ...options, signal }, (t) => {
        if (name !== terminal) lastOperation = name;
        if (name !== terminal && (name === target || ["fixture", "claim", "run"].includes(mode))) {
          targetSignal = t.signal;
          t.after(() => {
            pendingHooks++;
            const pending = cleanup();
            hookEntered.resolve();
            return pending.finally(() => pendingHooks--);
          }, hookOptions);
        }
        const pending = callback(t);
        if (name !== terminal)
          physical = pending
            .finally(() => events.push(`physical-settled:${name}`))
            .catch(() => undefined);
        return pending;
      });
    },
  };
  const running = runSourceGate({
    ...(native ? {} : registration),
    createFixture: async () => {
      if (mode === "fixture") throw operationError;
      for (const file of [nodeBin, launcher]) await write(file, "UNIT nonexecutable placeholder");
      return {
        prefix,
        nodeBin,
        run: async (args) => {
          if (mode === "run") throw operationError;
          if (args[0] === pnpm) {
            assert.deepEqual(args, [pnpm, "--version"]);
            return { stdout: "11.7.0" };
          }
          assert.deepEqual(args, [source, "--work", work]);
          return { stdout: receipt };
        },
        dispose: async () => {
          premature ||= held !== 0;
          events.push("dispose");
          if (mode === "mutation" || native) {
            assert.equal(
              await fs.readFile(receiptFile, "utf8"),
              receipt,
              "actual finally restored bytes",
            );
            assert.equal((await fs.lstat(receiptFile)).mode, receiptMode);
            await assert.rejects(fs.lstat(path.join(work, "parked")), { code: "ENOENT" });
          }
          await fs.rm(prefix, { recursive: true });
          if (mode === "cleanup") throw disposalError;
        },
      };
    },
    claimWork: async () => {
      if (mode === "claim") throw operationError;
      Object.assign(identity, {
        node: { path: nodeBin, version: "v24.16.0", sha256: sha256(await fs.readFile(nodeBin)) },
        launcher: { path: launcher, sha256: sha256(await fs.readFile(launcher)) },
        pnpm: { source: "corepack", version: "11.7.0" },
      });
      receipt = JSON.stringify(identity);
      await write(pnpm, "UNIT nonexecutable placeholder");
      await write(receiptFile, receipt);
      receiptMode = (await fs.lstat(receiptFile)).mode;
      return work;
    },
    sourceHash: async () => {
      hashes++;
      if (mode === "cleanup" && hashes === 2) return "UNIT changed source hash";
      return sha256(await fs.readFile(source));
    },
    inspectSource: async () => {
      if (mode === "cleanup") throw operationError;
      if (native) {
        assert.equal(await fs.readFile(receiptFile, "utf8"), receipt);
        return { work, identity };
      }
      if (mode === "mutation" && !names.includes(missing)) return { work, identity };
      held++;
      entered.resolve();
      try {
        await release.promise;
      } finally {
        held--;
      }
      if (mode === "mutation") throw new Error("UNIT missing identity rejects");
      return { work, identity };
    },
    registerCases: async (gate, prepared) => {
      const cases = new Map(await collect(prepared));
      await gate.test(initial, cases.get(initial));
      await gate.test(missing, cases.get(missing));
      if (!native) assert.fail("poisoned source cannot register the next action");
      await gate.test("UNIT later restored admission", async () => {
        assert.deepEqual(await prepared.inspect(), { work, identity });
        assert.equal(await fs.readFile(receiptFile, "utf8"), receipt);
        assert.equal((await fs.lstat(receiptFile)).mode, receiptMode);
        await assert.rejects(fs.lstat(path.join(work, "parked")), { code: "ENOENT" });
      });
    },
  });
  const outcome = settled(running);
  let result;
  try {
    if (cancel) {
      await entered.promise;
      if (mode === "mutation") {
        await assert.rejects(fs.lstat(receiptFile), { code: "ENOENT" });
        assert.equal(await fs.readFile(path.join(work, "parked"), "utf8"), receipt);
      }
      controller.abort();
      await hookEntered.promise;
      assert.equal(held, 1);
      assert.equal(
        events.includes("dispose"),
        false,
        "cleanup must wait for physical source callback settlement",
      );
      assert.equal(names.at(-1), target);
    }
  } finally {
    release.resolve();
    result = await outcome;
    await physical;
    if (cleanup) {
      const finished = await settled(cleanup());
      if (!finished.ok) cleanupError = finished.error;
    }
    assert.equal(process.umask(), umask);
    entered.resolve();
    hookEntered.resolve();
    await Promise.all([entered.promise, hookEntered.promise, release.promise]);
  }
  assert.equal(result.ok, native, result.error?.stack);
  if (!native) {
    const expected = cancel ? targetSignal.reason : operationError;
    if (mode === "cleanup") assert.ok(causes(result.error).has(expected));
    else assert.equal(result.error, expected);
  }
  assert.equal(hashes, 2, "source hash verification still executes after cleanup failure");
  assert.equal(held, 0);
  assert.equal(pendingHooks, 0);
  assert.deepEqual(await fs.readdir(root), []);
  if (mode === "cleanup") {
    assert.ok(cleanupError.errors.includes(operationError));
    assert.ok(causes(result.error).has(cleanupError));
    assert.equal(cleanupError.cause, cleanupError.errors.at(-1));
    assert.match(cleanupError.errors.at(-1).message, /fixture: UNIT cleanup failure.*source hash:/);
  } else assert.equal(cleanupError, undefined);
  assert.equal(premature, false);
  if (!native && events.includes("dispose")) {
    const completed = events.indexOf(`physical-settled:${lastOperation}`);
    assert.ok(completed >= 0 && completed < events.indexOf("dispose"));
  }
}

async function finalUnit(root, mode) {
  const operationError = new Error("UNIT driver operation");
  const cleanupError = new Error("UNIT physical cleanup");
  const secondaryError = new Error("UNIT independent cleanup");
  const admissionError = new Error("UNIT terminal registration");
  const controller = new globalThis.AbortController();
  const entered = Promise.withResolvers();
  const acknowledged = Promise.withResolvers();
  const release = Promise.withResolvers();
  const held = mode.startsWith("cancel-");
  const synthetic = ["omit", "omit-success", "reject-error", "reject-falsy"].includes(mode);
  const failsCleanup = !["success", "cancel-success", "omit-success"].includes(mode);
  const firstError = ["reject-falsy", "preabort", "cancel-falsy"].includes(mode)
    ? false
    : cleanupError;
  const owned = path.join(root, "cleanup-owned");
  await fs.mkdir(owned);
  let registrations = 0;
  let callbacks = 0;
  let cleanups = 0;
  let tails = 0;
  let pendingHooks = 0;
  let physical, logical, signal, rawFinish;
  let finalSettled = false;
  if (mode === "preabort") controller.abort(admissionError);
  const gate = createSourceGate(
    (name, options, callback) => {
      registrations++;
      assert.equal(name, terminal);
      assert.equal(options.timeout, 300_000);
      if (mode === "omit" || mode === "omit-success") return Promise.resolve();
      if (mode === "reject-error") return Promise.reject(admissionError);
      if (mode === "reject-falsy") return Promise.reject(undefined);
      logical = test(`UNIT ${name}`, { ...options, signal: controller.signal }, (t) => {
        callbacks++;
        signal = t.signal;
        t.after(
          () => {
            pendingHooks++;
            try {
              acknowledged.resolve();
            } finally {
              pendingHooks--;
            }
          },
          { timeout: 300_000 },
        );
        physical = callback(t);
        return physical;
      });
      if (mode === "cancel-error")
        return logical.then(() => {
          throw admissionError;
        });
      return logical;
    },
    (finish, options) => {
      assert.equal(options.timeout, 300_000);
      rawFinish = finish;
    },
    [
      [
        "physical",
        async () => {
          cleanups++;
          entered.resolve();
          if (held) await release.promise;
          await fs.rm(owned, { recursive: true });
          if (failsCleanup) throw firstError;
        },
      ],
      [
        "independent",
        () => {
          if (failsCleanup) throw secondaryError;
        },
      ],
      [
        "tail",
        () => {
          tails++;
        },
      ],
    ],
  );
  const running = settled(
    gate.run(() => {
      if (mode !== "success") throw operationError;
      return 42;
    }),
  );
  const final = gate.finalize();
  assert.equal(gate.finalize(), final);
  const finalResult = settled(final).then((result) => {
    finalSettled = true;
    return result;
  });
  try {
    await entered.promise;
    if (held) {
      controller.abort();
      await acknowledged.promise;
      await logical;
      assert.equal(signal.aborted, true);
      assert.equal(finalSettled, false, "logical failure cannot settle physical finalization");
      assert.equal(gate.snapshot().listeners, 1);
      assert.equal(cleanups, 1);
      assert.equal(tails, 0);
      assert.equal((await fs.lstat(owned)).isDirectory(), true);
    }
  } finally {
    release.resolve();
    await settled(physical ?? Promise.resolve());
    await logical;
    await running;
    await finalResult;
    acknowledged.resolve();
    await Promise.all([entered.promise, acknowledged.promise, release.promise]);
  }
  const result = await running;
  const finalized = await finalResult;
  assert.equal(result.ok, mode === "success");
  assert.equal(finalized.ok, mode === "success");
  if (mode === "success") assert.equal(result.value, 42);
  else {
    assert.equal(result.error, finalized.error);
    const retained = causes(result.error);
    assert.ok(retained.has(operationError));
    if (held) assert.ok(retained.has(signal.reason));
    if (mode === "reject-error" || mode === "cancel-error") assert.ok(retained.has(admissionError));
    if (mode === "reject-falsy") assert.ok(retained.has(undefined));
    if (synthetic || mode === "preabort")
      assert.ok(
        [...retained].some(
          (error) => error instanceof Error && /callback did not start/.test(error.message),
        ),
      );
    if (failsCleanup) {
      assert.ok(
        [...retained].some(
          (error) =>
            error instanceof Error &&
            /physical: .*; independent: UNIT independent cleanup/.test(error.message),
        ),
      );
    }
  }
  const finished = await settled(rawFinish());
  assert.equal(finished.ok, !failsCleanup);
  if (!finished.ok) {
    assert.ok(causes(result.error).has(finished.error));
    assert.equal(finished.error.cause, finished.error.errors.at(-1));
    assert.ok(causes(result.error).has(finished.error.cause));
    if (firstError === false) assert.match(finished.error.cause.message, /physical: false;/);
  }
  assert.equal(gate.finalize(), final);
  assert.equal(registrations, 1);
  assert.equal(callbacks, synthetic || mode === "preabort" ? 0 : 1);
  assert.equal(cleanups, 1);
  assert.equal(tails, 1);
  assert.equal(pendingHooks, 0);
  assert.equal(finalSettled, true);
  idle(gate);
  assert.deepEqual(await fs.readdir(root), []);
  await assert.rejects(fs.lstat(owned), { code: "ENOENT" });
  if (synthetic) await test("UNIT finalization assertions", { timeout: 300_000 }, () => {});
}

if (process.argv[2] === "--unit") {
  const [, , , family, mode, root] = process.argv;
  await (family === "source" ? sourceUnit(root, mode) : finalUnit(root, mode));
  process.stdout.write(`${marker}${family}:${mode}\n`);
} else {
  const profiles = [
    ["source", "success", 5, 5, 0, 0],
    ["source", "initial", 3, 2, 0, 1],
    ["source", "mutation", 4, 3, 0, 1],
    ["source", "fixture", 2, 1, 1, 0],
    ["source", "claim", 2, 1, 1, 0],
    ["source", "run", 2, 1, 1, 0],
    ["source", "cleanup", 3, 1, 2, 0],
    ["final", "success", 1, 1, 0, 0],
    ["final", "omit", 1, 1, 0, 0],
    ["final", "omit-success", 1, 1, 0, 0],
    ["final", "reject-error", 1, 1, 0, 0],
    ["final", "reject-falsy", 1, 1, 0, 0],
    ["final", "preabort", 1, 0, 0, 1],
    ["final", "cancel-success", 1, 0, 0, 1],
    ["final", "cancel-error", 1, 0, 0, 1],
    ["final", "cancel-falsy", 1, 0, 0, 1],
  ];
  for (const [family, mode, roots, pass, fail, cancelled] of profiles)
    test(`UNIT ${family} lifecycle ${mode}`, async (t) => {
      assert.equal(process.version, "v24.16.0");
      const root = await fs.realpath(
        await fs.mkdtemp(path.join(os.tmpdir(), "ast103-source-unit-")),
      );
      const env = {
        ...process.env,
        NODE_OPTIONS: "",
        NODE_DISABLE_COMPILE_CACHE: "1",
        TMPDIR: root,
      };
      delete env.NODE_TEST_CONTEXT;
      let result;
      try {
        const command = await settled(
          runBoundedCommand(
            process.execPath,
            ["--test-reporter=tap", import.meta.filename, "--unit", family, mode, root],
            { timeout: 5_000, maxBuffer: 1024 * 1024, env },
          ),
        );
        result = command.ok ? command.value : command.error;
        t.diagnostic(
          JSON.stringify({ family, mode, ok: command.ok, message: result.message, ...result }),
        );
        assert.equal(command.ok, fail + cancelled === 0);
        if (!command.ok) assert.match(result.message, /exited with 1$/);
      } finally {
        await fs.rm(root, { recursive: true, force: true });
        await assert.rejects(fs.lstat(root), { code: "ENOENT" });
      }
      const lines = result.stdout.split("\n").filter((line) => line.startsWith(marker));
      assert.deepEqual(lines, [`${marker}${family}:${mode}`], `${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout, new RegExp(`^1\\.\\.${roots}$`, "m"));
      assert.doesNotMatch(result.stdout, /^# Error:/m);
      assert.equal(result.stderr, "");
      for (const [key, value] of Object.entries({
        tests: roots,
        pass,
        fail,
        cancelled,
        suites: 0,
        skipped: 0,
        todo: 0,
      }))
        assert.match(result.stdout, new RegExp(`^# ${key} ${value}$`, "m"));
      const names = result.stdout
        .split("\n")
        .filter((line) => line.startsWith("# Subtest: "))
        .map((line) => line.slice(11));
      const expected =
        family === "source"
          ? mode === "success"
            ? [
                "prepare official sources",
                initial,
                missing,
                "UNIT later restored admission",
                terminal,
              ]
            : [
                "prepare official sources",
                ...(["initial", "mutation", "cleanup"].includes(mode) ? [initial] : []),
                ...(mode === "mutation" ? [missing] : []),
                terminal,
              ].map((name) => `UNIT ${name}`)
          : [
              ["omit", "omit-success", "reject-error", "reject-falsy"].includes(mode)
                ? "UNIT finalization assertions"
                : `UNIT ${terminal}`,
            ];
      assert.deepEqual(names, expected);
    });

  test("UNIT owner reuse, physical errors, pre-abort and concurrent admission", async () => {
    const faults = [
      "success",
      "throw",
      "reject",
      undefined,
      "preabort",
      "cancel",
      "cancel-falsy",
      "not-entered",
    ];
    for (const fault of faults) {
      let controller = new globalThis.AbortController();
      const failure = fault === undefined ? undefined : new Error(fault);
      if (fault === "preabort") controller.abort(failure);
      let registered = 0,
        invoked = 0;
      const gate = createSourceGate(
        async (_name, options, callback) => {
          assert.equal(options.timeout, 300_000);
          registered++;
          if (fault !== "not-entered")
            return callback({
              signal:
                _name === terminal ? new globalThis.AbortController().signal : controller.signal,
            });
        },
        () => {},
        [],
      );
      const run = gate.test("first", () => {
        invoked++;
        if (fault === "throw") throw failure;
        if (["cancel", "cancel-falsy"].includes(fault)) controller.abort(failure);
        if (fault === "cancel-falsy") return Promise.reject(undefined);
        return ["reject", undefined].includes(fault) ? Promise.reject(failure) : 42;
      });
      if (fault === "success") {
        assert.equal(await run, 42);
        controller.abort(); // The completed context no longer owns cancellation.
        controller = new globalThis.AbortController();
        assert.equal(await gate.test("second", () => 43), 43);
      } else {
        const caught = await run.catch((error) => error);
        assert.equal(
          fault === "not-entered" ? caught.message : caught,
          fault === "not-entered" ? "first: callback did not start" : failure,
        );
        await assert.rejects(
          gate.test("refused", () => assert.fail()),
          (error) => error === caught,
        );
        assert.equal(registered, 1);
      }
      assert.equal(invoked, ["preabort", "not-entered"].includes(fault) ? 0 : 1);
      if (fault === "cancel-falsy") {
        const result = await settled(gate.finalize());
        assert.equal(result.ok, false);
        assert.ok(causes(result.error).has(failure));
        assert.ok(causes(result.error).has(undefined));
      }
      await gate.finish();
      idle(gate);
    }
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    const gate = createSourceGate(
      (_name, _options, callback) => callback({ signal: new globalThis.AbortController().signal }),
      () => {},
      [],
    );
    const active = gate.test("held", async () => {
      entered.resolve();
      await release.promise;
    });
    try {
      await entered.promise;
      await assert.rejects(
        gate.test("concurrent", () => assert.fail()),
        /concurrent source/,
      );
      assert.equal(gate.snapshot().active, 1);
    } finally {
      release.resolve();
      await active;
      await gate.finish();
    }
    idle(gate);
  });

  test("UNIT independent inventory retains initial admission and all56 controls", async () => {
    const cases = await collect({ work: "/UNIT/work", outside: "/UNIT/outside", identity });
    const names = cases.slice(1).map(([name]) => {
      const match = /^rejects recorded (\w+): (.*)$/.exec(name);
      if (!match) return name;
      const [, key, value] = match;
      if (value === "undefined") return `missing field ${key}`;
      if (key !== "sources") return `recorded ${key}`;
      return `source ${Object.entries(JSON.parse(value)).find(([, hash]) => hash === "0".repeat(64))[0]}`;
    });
    const fields = ["work", "inputRevision", "seriesSha256", "series", "trees", "sources"];
    const expected = [
      "rejects coordinated source/index/receipt tampering",
      ...fields.slice(0, 5).map((key) => `recorded ${key}`),
      ...["a", "b", "c"].map((key) => `source ${key}`),
      ...fields.map((key) => `missing field ${key}`),
      "rejects malformed identity",
      "rejects retained patch changes",
      ...["baseline", "candidate"].flatMap((variant) => [
        ...["stat cache", "assume-unchanged", "skip-worktree"].map(
          (flag) => `${variant} rejects bytes hidden by ${flag}`,
        ),
        `${variant} tracked executable mode rejects`,
        `${variant} index differs from independent tree`,
        `${variant} wrong or attached HEAD ${"0".repeat(40)}`,
        `${variant} wrong or attached HEAD ref: refs/remotes/origin/main`,
        `${variant} origin mismatch`,
      ]),
      ...[
        "baseline",
        "candidate",
        "candidate/.git",
        "candidate/.git/index",
        "candidate/.git/objects",
        "identity.json",
        "patches",
        "patches/first.patch",
        "candidate/packages",
        "candidate/package.json",
      ].map((file) => `rejects symlink component ${file}`),
      ...["identity.json", "candidate/.git/index"].map((file) => `rejects hardlink alias ${file}`),
      ...["identity.json", "candidate/.git/index", "patches", "baseline"].map(
        (file) => `rejects missing ${file}`,
      ),
      ...[
        ".preparing",
        "candidate/.git/objects/info/alternates",
        "candidate/.git/commondir",
        "baseline/untracked",
      ].map((file) => `rejects unexpected ${file}`),
      "rejects writable work without repairing it",
      "rejects aliased work",
      "ignored dependency/build outputs survive readmission",
    ];
    assert.equal(cases[0][0], "fresh official sources readmit without writes");
    assert.equal(new Map(cases).size, expected.length + 1);
    assert.deepEqual(names, expected);
  });
}
