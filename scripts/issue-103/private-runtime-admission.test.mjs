import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { createNodeFixture } from "./node-fixture.mjs";
import { createSourceGate } from "./source-gate-lifecycle.mjs";
import { claimWork, sha256 } from "./prepare-harness.mjs";

const prepareSource = path.join(import.meta.dirname, "prepare-harness.mjs");
const admissionScript = `
  import { inspectPrivateRuntime } from ${JSON.stringify(prepareSource)};
  try {
    console.log(JSON.stringify({ ok: true, value: await inspectPrivateRuntime(process.argv[1]) }));
  } catch (error) {
    console.log(JSON.stringify({ ok: false, code: error.code, message: error.message }));
  }
`;

const fallbackReceiptMutationAdmissionScript = `
  import fs from "node:fs";
  import path from "node:path";
  import { syncBuiltinESMExports } from "node:module";

  const work = process.argv[1];
  const receiptFile = path.resolve(process.argv[2]);
  const originalReadFile = fs.promises.readFile;
  const originalReceipt = await originalReadFile(receiptFile);
  const forged = JSON.parse(originalReceipt);
  forged.mutationProbe = "fallback-final-receipt-read";
  const forgedReceipt = Buffer.from(JSON.stringify(forged) + "\\n");
  let receiptReads = 0;

  fs.promises.readFile = async function readFileWithReceiptMutation(file, ...args) {
    const result = await originalReadFile.call(this, file, ...args);
    if (path.resolve(String(file)) === receiptFile) {
      receiptReads += 1;
      if (receiptReads === 2) await fs.promises.writeFile(receiptFile, forgedReceipt);
    }
    return result;
  };
  syncBuiltinESMExports();

  const { inspectPrivateRuntime } = await import(${JSON.stringify(prepareSource)});
  try {
    console.log(JSON.stringify({ ok: true, receiptReads, value: await inspectPrivateRuntime(work) }));
  } catch (error) {
    console.log(JSON.stringify({ ok: false, receiptReads, code: error.code, message: error.message }));
  }
`;

const fallbackPrepareScript = `
  import assert from "node:assert/strict";
  import { createHash } from "node:crypto";
  import * as fs from "node:fs/promises";
  import path from "node:path";
  import { createRequire } from "node:module";
  import { prepare } from ${JSON.stringify(prepareSource)};
  import { PNPM_SHA512_HEX, PNPM_VERSION } from ${JSON.stringify(path.join(import.meta.dirname, "../private-pnpm.mjs"))};

  const { t: listTar, x: extractTar } = createRequire(${JSON.stringify(prepareSource)})("tar");

  function shellQuote(value) {
    return \`'\${String(value).replaceAll("'", \`'"'"'\`)}'\`;
  }

  async function provision({ environment, binDirectory, nodeBin }) {
    const fallbackRoot = path.join(environment.COREPACK_HOME, "fallback");
    await fs.mkdir(fallbackRoot, { recursive: true });
    const archive = path.join(fallbackRoot, \`pnpm-\${PNPM_VERSION}.tgz\`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("pnpm archive download timeout")), 120_000);
    let compressedBytes;
    try {
      const response = await fetch(\`https://registry.npmjs.org/pnpm/-/pnpm-\${PNPM_VERSION}.tgz\`, { signal: controller.signal });
      assert.equal(response.status, 200, "pnpm archive download status");
      const chunks = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        assert.ok(size <= 8 * 1024 * 1024, "pnpm archive compressed size bound");
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks);
      assert.equal(createHash("sha512").update(bytes).digest("hex"), PNPM_SHA512_HEX);
      compressedBytes = bytes.length;
      await fs.writeFile(archive, bytes, { flag: "wx", mode: 0o600 });
    } finally {
      clearTimeout(timer);
    }
    const headers = { nonZeroUid: 0, nonZeroGid: 0, unsafeMode: 0, entries: 0 };
    await listTar({
      file: archive,
      strict: true,
      onentry(entry) {
        headers.entries += 1;
        if (entry.uid && entry.uid !== 0) headers.nonZeroUid += 1;
        if (entry.gid && entry.gid !== 0) headers.nonZeroGid += 1;
        if ((entry.mode ?? 0) & 0o022) headers.unsafeMode += 1;
        entry.resume();
      },
    });
    assert.deepEqual({ ...headers, entries: headers.entries }, { nonZeroUid: 0, nonZeroGid: 0, unsafeMode: 0, entries: headers.entries });
    assert.ok(headers.entries > 0, "pnpm archive headers observed");
    const extractedRoot = path.join(fallbackRoot, "extracted");
    await fs.mkdir(extractedRoot, { recursive: true });
    const originalUmask = process.umask(0o000);
    try {
      await extractTar({
        file: archive,
        cwd: extractedRoot,
        strict: true,
        filter(file, entry) {
          assert.ok(file === "package" || file.startsWith("package/"), "safe pnpm archive path");
          assert.ok(
            ["File", "OldFile", "Directory"].includes(entry.type),
            "safe pnpm entry type",
          );
          return true;
        },
      });
    } finally {
      process.umask(originalUmask);
    }
    async function removeDirectoryWriteBits(directory) {
      await fs.chmod(directory, 0o755);
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) await removeDirectoryWriteBits(target);
      }
    }
    await removeDirectoryWriteBits(extractedRoot);
    const entrypoint = path.join(extractedRoot, "package/bin/pnpm.cjs");
    await fs.readFile(entrypoint);
    await fs.writeFile(
      path.join(binDirectory, "pnpm"),
      \`#!/bin/sh\\nexec \${shellQuote(nodeBin)} \${shellQuote(entrypoint)} "\\$@"\\n\`,
      { flag: "wx", mode: 0o700 },
    );
    provision.observation = { compressedBytes, headers };
    return {
      version: PNPM_VERSION,
      descriptor: \`pnpm@\${PNPM_VERSION}+sha512.\${PNPM_SHA512_HEX}\`,
      sha512: PNPM_SHA512_HEX,
      source: "verified-archive-launcher",
    };
  }

  const identity = await prepare(process.argv[1], provision);
  console.log(JSON.stringify({ identity, observation: provision.observation }));
`;

async function footprint(directory) {
  const result = [];
  for (const name of (await fs.readdir(directory)).sort()) {
    const file = path.join(directory, name);
    const stat = await fs.lstat(file);
    result.push([
      path.relative(directory, file),
      stat.ino,
      stat.mode,
      stat.size,
      stat.mtimeMs,
      stat.ctimeMs,
    ]);
    if (stat.isDirectory()) result.push(...(await footprint(file)));
  }
  return result;
}

async function changed(file, bytes, action) {
  const original = await fs.readFile(file);
  try {
    await fs.writeFile(file, bytes);
    await action();
  } finally {
    await fs.writeFile(file, original);
  }
}

async function runAdmissionResult(fixture, work) {
  const result = await fixture.run(["--input-type=module", "-e", admissionScript, work], {
    cwd: work,
  });
  return JSON.parse(result.stdout);
}

async function runAdmission(fixture, work) {
  const result = await runAdmissionResult(fixture, work);
  assert.equal(result.ok, true, result.message);
  return result.value;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

async function sentinelSnapshot(file) {
  const stat = await fs.lstat(file);
  return [stat.ino, stat.mode, stat.size, stat.mtimeMs, stat.ctimeMs, await fs.readFile(file)];
}

async function assertRejectedReadOnly(work, action, match = {}, sentinels = []) {
  const before = await footprint(work);
  const sentinelBefore = await Promise.all(sentinels.map(sentinelSnapshot));
  const result = await action();
  assert.equal(result.ok, false, "admission should reject");
  if (match.code) assert.equal(result.code, match.code);
  if (match.message) assert.match(result.message, match.message);
  assert.deepEqual(await footprint(work), before, "rejected admission must not write owned work");
  assert.deepEqual(
    await Promise.all(sentinels.map(sentinelSnapshot)),
    sentinelBefore,
    "rejected admission must not write outside sentinels",
  );
}

async function withPathFault(target, fault, escapeTarget, action) {
  const original = await fs.lstat(target);
  const saved = `${target}.admission-saved`;
  const modeFault = fault.endsWith("write");
  if (!modeFault) await fs.rename(target, saved);
  try {
    if (modeFault)
      await fs.chmod(target, original.mode | (fault === "group-write" ? 0o020 : 0o002));
    else if (fault === "missing") {
      // The rename is the fault.
    } else if (fault === "wrong-type") {
      if (original.isDirectory()) await fs.writeFile(target, "not a directory");
      else await fs.mkdir(target);
    } else if (fault === "symlink-escape") await fs.symlink(escapeTarget, target);
    else throw new Error(`unknown path fault: ${fault}`);
    await action();
  } finally {
    if (modeFault) await fs.chmod(target, original.mode);
    else {
      await fs.rm(target, { recursive: true, force: true });
      await fs.rename(saved, target);
    }
  }
}

await test("private Corepack runtime admission is read-only and rejects unsafe prepared runtime state", async () => {
  assert.equal(process.version, "v24.16.0");
  const owned = { umask: process.umask(0o077) };
  const gate = createSourceGate(test, test.after, [
    ["fixture", () => owned.fixture?.dispose()],
    [
      "fixture absence",
      () =>
        owned.fixture?.prefix && assert.rejects(fs.lstat(owned.fixture.prefix), { code: "ENOENT" }),
    ],
    ["work", () => owned.work && fs.rm(owned.work, { recursive: true })],
    ["work absence", () => owned.work && assert.rejects(fs.lstat(owned.work), { code: "ENOENT" })],
    ["umask", () => process.umask(owned.umask)],
    ["umask restoration", () => assert.equal(process.umask(), owned.umask)],
  ]);

  await gate.run(async () => {
    owned.fixture = await createNodeFixture();
    owned.work = await claimWork();
    const identity = JSON.parse(
      (await owned.fixture.run([prepareSource, "--work", owned.work], { cwd: owned.work })).stdout,
    );
    const receiptFile = path.join(owned.work, "identity.json");
    const receipt = await fs.readFile(receiptFile);
    const launcher = path.join(owned.work, "private/package-manager/bin/pnpm");
    const outsideSentinel = path.join(owned.fixture.prefix, "runtime-admission-outside-sentinel");
    await fs.writeFile(outsideSentinel, "outside state must stay untouched\n");

    await gate.test("admits exact prepared private Corepack runtime without writes", async () => {
      const before = await footprint(owned.work);
      const admitted = await runAdmission(owned.fixture, owned.work);
      assert.deepEqual(admitted.identity, identity);
      assert.deepEqual(admitted, { work: owned.work, identity, launcher });
      assert.deepEqual(await footprint(owned.work), before);
      assert.deepEqual(await fs.readFile(receiptFile), receipt);
    });

    await gate.test("admits reformatted receipt JSON repeatedly without writes", async () => {
      const formattedReceipt = `${JSON.stringify(identity, null, 4)}\n`;
      await changed(receiptFile, formattedReceipt, async () => {
        const before = await footprint(owned.work);
        for (const admitted of [
          await runAdmission(owned.fixture, owned.work),
          await runAdmission(owned.fixture, owned.work),
        ]) {
          assert.deepEqual(admitted.identity, identity);
          assert.deepEqual(admitted, { work: owned.work, identity, launcher });
        }
        assert.deepEqual(await footprint(owned.work), before);
        assert.equal(await fs.readFile(receiptFile, "utf8"), formattedReceipt);
      });
    });

    await gate.test("rejects unsupported pnpm source with typed code", async () => {
      const forged = {
        ...identity,
        pnpm: { ...identity.pnpm, source: "unsupported-profile" },
      };
      await changed(receiptFile, `${JSON.stringify(forged)}\n`, async () => {
        await assertRejectedReadOnly(
          owned.work,
          () => runAdmissionResult(owned.fixture, owned.work),
          { code: "ERR_UNSUPPORTED_PNPM_PROFILE" },
        );
      });
    });

    await gate.test("rejects unknown pnpm profile before stale source", async () => {
      const forged = {
        ...identity,
        inputRevision: "stale",
        pnpm: { ...identity.pnpm, source: "unknown" },
      };
      await changed(receiptFile, `${JSON.stringify(forged)}\n`, async () => {
        await assertRejectedReadOnly(
          owned.work,
          () => runAdmissionResult(owned.fixture, owned.work),
          { code: "ERR_UNSUPPORTED_PNPM_PROFILE", message: /unsupported pnpm profile/ },
          [outsideSentinel],
        );
      });
    });

    for (const [name, mutate] of [
      ["missing pnpm metadata", (copy) => delete copy.pnpm],
      ["wrong pnpm version", (copy) => (copy.pnpm = { ...copy.pnpm, version: "0.0.0" })],
      ["wrong pnpm descriptor", (copy) => (copy.pnpm = { ...copy.pnpm, descriptor: "pnpm@0.0.0" })],
      ["wrong pnpm sha512", (copy) => (copy.pnpm = { ...copy.pnpm, sha512: "0".repeat(128) })],
    ])
      await gate.test(`rejects malformed metadata: ${name}`, async () => {
        const forged = globalThis.structuredClone(identity);
        mutate(forged);
        await changed(receiptFile, `${JSON.stringify(forged)}\n`, () =>
          assertRejectedReadOnly(owned.work, () => runAdmissionResult(owned.fixture, owned.work)),
        );
      });

    for (const [record, field, value] of [
      ["node", "path", path.join(owned.work, "private/tmp/not-node")],
      ["node", "version", "recorded-version-binding-mismatch"],
      ["node", "sha256", "0".repeat(64)],
      ["git", "binary", path.join(owned.work, "private/tmp/not-git")],
      ["git", "realpath", path.join(owned.work, "private/tmp/not-git-real")],
      ["git", "sha256", "0".repeat(64)],
      ["launcher", "path", path.join(owned.work, "private/tmp/not-corepack")],
      ["launcher", "sha256", "0".repeat(64)],
    ])
      await gate.test(`rejects recorded ${record}.${field} binding mismatch`, async () => {
        const forged = globalThis.structuredClone(identity);
        forged[record][field] = value;
        await changed(receiptFile, `${JSON.stringify(forged)}\n`, () =>
          assertRejectedReadOnly(
            owned.work,
            () => runAdmissionResult(owned.fixture, owned.work),
            { message: new RegExp(`recorded ${record}\\.${field}`) },
            [outsideSentinel],
          ),
        );
      });

    for (const [record, value] of [
      ["node", []],
      ["git", "not a record"],
      ["launcher", null],
    ])
      await gate.test(`rejects malformed recorded ${record} shape`, async () => {
        const forged = globalThis.structuredClone(identity);
        forged[record] = value;
        await changed(receiptFile, `${JSON.stringify(forged)}\n`, () =>
          assertRejectedReadOnly(
            owned.work,
            () => runAdmissionResult(owned.fixture, owned.work),
            { message: new RegExp(`recorded ${record}`) },
            [outsideSentinel],
          ),
        );
      });

    for (const [record, field] of [
      ["node", "path"],
      ["node", "version"],
      ["node", "sha256"],
      ["git", "binary"],
      ["git", "realpath"],
      ["git", "sha256"],
      ["launcher", "path"],
      ["launcher", "sha256"],
    ])
      await gate.test(`rejects missing recorded ${record}.${field}`, async () => {
        const forged = globalThis.structuredClone(identity);
        delete forged[record][field];
        await changed(receiptFile, `${JSON.stringify(forged)}\n`, () =>
          assertRejectedReadOnly(
            owned.work,
            () => runAdmissionResult(owned.fixture, owned.work),
            { message: new RegExp(`recorded ${record}\\.${field}`) },
            [outsideSentinel],
          ),
        );
      });

    await gate.test("rejects forged recorded Git binary without executing it", async () => {
      const forgedGit = path.join(owned.work, "private/tmp/forged-git");
      const marker = path.join(owned.work, "private/tmp/forged-git-executed");
      await fs.writeFile(forgedGit, `#!/bin/sh\necho executed >${JSON.stringify(marker)}\n`);
      await fs.chmod(forgedGit, 0o700);
      try {
        const forged = globalThis.structuredClone(identity);
        forged.git.binary = forgedGit;
        await changed(receiptFile, `${JSON.stringify(forged)}\n`, async () => {
          await assertRejectedReadOnly(
            owned.work,
            () => runAdmissionResult(owned.fixture, owned.work),
            { message: /recorded git\.binary/ },
            [outsideSentinel],
          );
          await assert.rejects(fs.lstat(marker), { code: "ENOENT" });
        });
      } finally {
        await fs.rm(forgedGit, { force: true });
        await fs.rm(marker, { force: true });
      }
    });

    await gate.test("rejects source tamper before runtime success", async () => {
      await changed(path.join(owned.work, "candidate/package.json"), "{}\n", () =>
        assertRejectedReadOnly(owned.work, () => runAdmissionResult(owned.fixture, owned.work)),
      );
    });

    for (const [name, setup, match] of [
      ["missing", async () => {}, { message: /ENOENT|no such file|private Corepack launcher/ }],
      [
        "regular file",
        () => fs.writeFile(launcher, "not a symlink"),
        { message: /private Corepack launcher/ },
      ],
      [
        "explicit dangling symlink",
        () => fs.symlink(path.join(owned.work, "private/missing-corepack.js"), launcher),
        { message: /private Corepack launcher text/ },
      ],
      [
        "indirect symlink to valid Corepack",
        async () => {
          const alias = path.join(owned.work, "private/tmp/corepack-alias.js");
          await fs.symlink(identity.launcher.path, alias);
          await fs.symlink(alias, launcher);
        },
        { message: /private Corepack launcher text/ },
      ],
      [
        "same-byte copied target at wrong path",
        async () => {
          const copy = path.join(owned.work, "private/tmp/corepack-copy.js");
          await fs.copyFile(identity.launcher.path, copy);
          await fs.symlink(copy, launcher);
        },
        { message: /private Corepack launcher text/ },
      ],
    ])
      await gate.test(`rejects unsafe private launcher: ${name}`, async () => {
        const parked = path.join(owned.work, "private/package-manager/bin/pnpm.parked");
        await fs.rename(launcher, parked);
        try {
          await setup();
          await assertRejectedReadOnly(
            owned.work,
            () => runAdmissionResult(owned.fixture, owned.work),
            match,
            [outsideSentinel],
          );
        } finally {
          await fs.rm(launcher, { recursive: true, force: true });
          await fs.rm(path.join(owned.work, "private/tmp/corepack-alias.js"), { force: true });
          await fs.rm(path.join(owned.work, "private/tmp/corepack-copy.js"), { force: true });
          await fs.rename(parked, launcher);
        }
      });

    await gate.test(
      "rejects coordinated forged launcher receipt and same-byte target",
      async () => {
        const parked = path.join(owned.work, "private/package-manager/bin/pnpm.parked");
        const copy = path.join(owned.work, "private/tmp/corepack-forged-copy.js");
        await fs.rename(launcher, parked);
        try {
          await fs.copyFile(identity.launcher.path, copy);
          await fs.symlink(copy, launcher);
          const forged = globalThis.structuredClone(identity);
          forged.launcher.path = copy;
          forged.launcher.sha256 = sha256(await fs.readFile(copy));
          await changed(receiptFile, `${JSON.stringify(forged)}\n`, () =>
            assertRejectedReadOnly(
              owned.work,
              () => runAdmissionResult(owned.fixture, owned.work),
              { message: /recorded launcher\.path/ },
              [outsideSentinel],
            ),
          );
        } finally {
          await fs.rm(launcher, { force: true });
          await fs.rm(copy, { force: true });
          await fs.rename(parked, launcher);
        }
      },
    );

    await gate.test("rejects private bin/node shadow", async () => {
      const shadow = path.join(owned.work, "private/package-manager/bin/node");
      try {
        await fs.writeFile(shadow, "shadow");
        await assertRejectedReadOnly(owned.work, () =>
          runAdmissionResult(owned.fixture, owned.work),
        );
      } finally {
        await fs.rm(shadow, { force: true });
      }
    });

    for (const [form, create] of [
      [
        "dangling symlink",
        () =>
          fs.symlink(
            path.join(owned.work, "private/missing-node"),
            path.join(owned.work, "private/package-manager/bin/node"),
          ),
      ],
      [
        "real-node symlink",
        () =>
          fs.symlink(process.execPath, path.join(owned.work, "private/package-manager/bin/node")),
      ],
      ["directory", () => fs.mkdir(path.join(owned.work, "private/package-manager/bin/node"))],
    ])
      await gate.test(`rejects private bin/node shadow: ${form}`, async () => {
        const shadow = path.join(owned.work, "private/package-manager/bin/node");
        try {
          await create();
          await assertRejectedReadOnly(
            owned.work,
            () => runAdmissionResult(owned.fixture, owned.work),
            {},
            [outsideSentinel],
          );
        } finally {
          await fs.rm(shadow, { recursive: true, force: true });
        }
      });

    for (const [relative, fault] of [
      ["private", "symlink-escape"],
      ["private/tmp", "wrong-type"],
      ["private/package-manager", "missing"],
      ["private/package-manager/bin", "world-write"],
      ["private/package-manager/corepack", "group-write"],
      ["private/package-manager/pnpm", "symlink-escape"],
      ["private/package-manager/home", "wrong-type"],
      ["private/package-manager/xdg-cache", "missing"],
      ["private/package-manager/xdg-config", "world-write"],
      ["private/package-manager/xdg-data", "group-write"],
      ["private/package-manager/xdg-state", "symlink-escape"],
      ["private/package-manager/npm-cache", "wrong-type"],
    ])
      await gate.test(`rejects unsafe private runtime path: ${relative} ${fault}`, async () => {
        await withPathFault(path.join(owned.work, relative), fault, outsideSentinel, () =>
          assertRejectedReadOnly(
            owned.work,
            () => runAdmissionResult(owned.fixture, owned.work),
            {},
            [outsideSentinel],
          ),
        );
      });

    for (const fault of ["nonempty", "hardlink"])
      await gate.test(`rejects unsafe private npmrc: ${fault}`, async () => {
        const npmrc = path.join(owned.work, "private/package-manager/npmrc");
        const alias = path.join(owned.work, "private/package-manager/npmrc.alias");
        try {
          if (fault === "nonempty") await fs.writeFile(npmrc, "registry=https://invalid.example\n");
          else await fs.link(npmrc, alias);
          await assertRejectedReadOnly(
            owned.work,
            () => runAdmissionResult(owned.fixture, owned.work),
            {},
            [outsideSentinel],
          );
        } finally {
          await fs.rm(alias, { force: true });
          await fs.writeFile(npmrc, "");
        }
      });

    await gate.test("rejects runtime receipt changes during admission", async () => {
      const original = globalThis.structuredClone(identity);
      const forged = { ...identity, sources: { ...identity.sources } };
      const file = "packages/core/tools/src/index.ts";
      const source = path.join(owned.work, "candidate", file);
      await changed(source, "// changed\n", async () => {
        try {
          forged.sources[file] = sha256(await fs.readFile(source));
          await fs.writeFile(receiptFile, `${JSON.stringify(forged)}\n`);
          await assertRejectedReadOnly(
            owned.work,
            () => runAdmissionResult(owned.fixture, owned.work),
            { message: /runtime identity changed|runtime receipt changed|source blob/ },
          );
        } finally {
          await fs.writeFile(receiptFile, `${JSON.stringify(original, null, 2)}\n`);
        }
      });
    });
  });
});

await test("verified archive fallback runtime admission authenticates retained pnpm tree without payload execution", async () => {
  assert.equal(process.version, "v24.16.0");
  const owned = { umask: process.umask(0o077) };
  const gate = createSourceGate(test, test.after, [
    ["fixture", () => owned.fixture?.dispose()],
    [
      "fixture absence",
      () =>
        owned.fixture?.prefix && assert.rejects(fs.lstat(owned.fixture.prefix), { code: "ENOENT" }),
    ],
    ["work", () => owned.work && fs.rm(owned.work, { recursive: true })],
    ["work absence", () => owned.work && assert.rejects(fs.lstat(owned.work), { code: "ENOENT" })],
    ["umask", () => process.umask(owned.umask)],
    ["umask restoration", () => assert.equal(process.umask(), owned.umask)],
  ]);

  await gate.run(async () => {
    owned.fixture = await createNodeFixture();
    owned.work = await claimWork();
    const prepared = JSON.parse(
      (
        await owned.fixture.run(["--input-type=module", "-e", fallbackPrepareScript, owned.work], {
          cwd: owned.work,
          timeout: 300_000,
        })
      ).stdout,
    );
    const { identity, observation } = prepared;
    assert.ok(observation.compressedBytes > 0, "authenticated fixture archive size observed");
    assert.deepEqual(observation.headers, {
      nonZeroUid: 0,
      nonZeroGid: 0,
      unsafeMode: 0,
      entries: observation.headers.entries,
    });
    const receiptFile = path.join(owned.work, "identity.json");
    const receipt = await fs.readFile(receiptFile);
    const launcher = path.join(owned.work, "private/package-manager/bin/pnpm");
    const marker = path.join(owned.work, "private/tmp/pnpm-payload-executed");
    const before = await footprint(owned.work);

    await gate.test("admits exact fallback archive launcher without writes", async () => {
      const admitted = await runAdmission(owned.fixture, owned.work);
      assert.deepEqual(admitted.identity, identity);
      assert.deepEqual(admitted, { work: owned.work, identity, launcher });
      assert.deepEqual(await footprint(owned.work), before);
      assert.deepEqual(await fs.readFile(receiptFile), receipt);
      await assert.rejects(fs.lstat(marker), { code: "ENOENT" });
    });

    for (const [name, mutate, match] of [
      [
        "archive tamper",
        async () =>
          fs.appendFile(
            path.join(owned.work, "private/package-manager/corepack/fallback/pnpm-11.7.0.tgz"),
            "x",
          ),
        /archive/,
      ],
      [
        "entrypoint tamper",
        async () =>
          fs.appendFile(
            path.join(
              owned.work,
              "private/package-manager/corepack/fallback/extracted/package/bin/pnpm.cjs",
            ),
            "\n// tamper\n",
          ),
        /file bytes differ/,
      ],
      [
        "dependency tamper",
        async () =>
          fs.appendFile(
            path.join(
              owned.work,
              "private/package-manager/corepack/fallback/extracted/package/package.json",
            ),
            "\n",
          ),
        /file bytes differ/,
      ],
      [
        "extra retained file",
        async () =>
          fs.writeFile(
            path.join(
              owned.work,
              "private/package-manager/corepack/fallback/extracted/package/extra.js",
            ),
            "extra",
          ),
        /extra retained path/,
      ],
      [
        "launcher symlink",
        async () => {
          await fs.rename(launcher, `${launcher}.saved`);
          await fs.symlink(
            path.join(
              owned.work,
              "private/package-manager/corepack/fallback/extracted/package/bin/pnpm.cjs",
            ),
            launcher,
          );
        },
        /fallback launcher|unsafe prepared path/,
      ],
      [
        "launcher wrong bytes",
        async () => fs.writeFile(launcher, "#!/bin/sh\nexit 1\n"),
        /fallback launcher bytes/,
      ],
      [
        "launcher wrong node",
        async () =>
          fs.writeFile(
            launcher,
            `#!/bin/sh\nexec ${shellQuote(path.join(owned.work, "private/tmp/not-node"))} ${shellQuote(path.join(owned.work, "private/package-manager/corepack/fallback/extracted/package/bin/pnpm.cjs"))} "$@"\n`,
          ),
        /fallback launcher bytes/,
      ],
      [
        "launcher wrong entrypoint",
        async () =>
          fs.writeFile(
            launcher,
            `#!/bin/sh\nexec ${shellQuote(identity.node.path)} ${shellQuote(path.join(owned.work, "private/package-manager/corepack/fallback/extracted/package/bin/not-pnpm.cjs"))} "$@"\n`,
          ),
        /fallback launcher bytes/,
      ],
    ])
      await gate.test(`rejects fallback mutation: ${name}`, async () => {
        const snapshot = await fs.mkdtemp(path.join(owned.work, "private/tmp/fallback-snapshot-"));
        await fs.cp(path.join(owned.work, "private/package-manager/corepack/fallback"), snapshot, {
          recursive: true,
        });
        const launcherBytes = await fs.readFile(launcher).catch(() => undefined);
        const launcherLink = await fs.readlink(launcher).catch(() => undefined);
        try {
          await mutate();
          await assertRejectedReadOnly(
            owned.work,
            () => runAdmissionResult(owned.fixture, owned.work),
            { message: match },
          );
        } finally {
          await fs.rm(path.join(owned.work, "private/package-manager/corepack/fallback"), {
            recursive: true,
            force: true,
          });
          await fs.cp(
            snapshot,
            path.join(owned.work, "private/package-manager/corepack/fallback"),
            {
              recursive: true,
            },
          );
          await fs.rm(snapshot, { recursive: true, force: true });
          await fs.rm(launcher, { force: true });
          await fs.rm(`${launcher}.saved`, { force: true });
          if (launcherLink !== undefined) await fs.symlink(launcherLink, launcher);
          else if (launcherBytes !== undefined)
            await fs.writeFile(launcher, launcherBytes, { mode: 0o700 });
        }
      });

    for (const [name, mutate, match] of [
      ["forged digest", (copy) => (copy.pnpm.sha512 = "0".repeat(128)), /pnpm metadata/],
      [
        "forged source",
        (copy) => (copy.pnpm.source = "corepack"),
        /recorded launcher\.path|private Corepack launcher/,
      ],
      [
        "forged launcher digest",
        (copy) => (copy.launcher.sha256 = "0".repeat(64)),
        /recorded launcher\.sha256/,
      ],
    ])
      await gate.test(`rejects fallback receipt mutation: ${name}`, async () => {
        const forged = globalThis.structuredClone(identity);
        mutate(forged);
        await changed(receiptFile, `${JSON.stringify(forged)}\n`, () =>
          assertRejectedReadOnly(owned.work, () => runAdmissionResult(owned.fixture, owned.work), {
            message: match,
          }),
        );
      });

    await gate.test("rejects fallback receipt changes during final admission reread", async () => {
      try {
        const result = JSON.parse(
          (
            await owned.fixture.run(
              [
                "--input-type=module",
                "-e",
                fallbackReceiptMutationAdmissionScript,
                owned.work,
                receiptFile,
              ],
              { cwd: owned.work },
            )
          ).stdout,
        );
        assert.equal(result.ok, false, "admission should reject receipt mutation");
        assert.equal(
          result.receiptReads,
          3,
          "mutation should occur between fallback receipt reads",
        );
        assert.match(result.message, /runtime receipt changed/);
      } finally {
        await fs.writeFile(receiptFile, receipt);
      }
      assert.deepEqual(await fs.readFile(receiptFile), receipt);
      await runAdmission(owned.fixture, owned.work);
    });

    await gate.test(
      "rejects replacement archive with coherently forged receipt digest",
      async () => {
        const archive = path.join(
          owned.work,
          "private/package-manager/corepack/fallback/pnpm-11.7.0.tgz",
        );
        const originalArchive = await fs.readFile(archive);
        const replacementArchive = Buffer.concat([originalArchive, Buffer.from("coherent-tamper")]);
        const replacementSha512 = createHash("sha512").update(replacementArchive).digest("hex");
        const forged = globalThis.structuredClone(identity);
        forged.pnpm.sha512 = replacementSha512;
        forged.pnpm.descriptor = `pnpm@${forged.pnpm.version}+sha512.${replacementSha512}`;
        try {
          await fs.writeFile(archive, replacementArchive);
          await fs.writeFile(receiptFile, `${JSON.stringify(forged)}\n`);
          const result = await runAdmissionResult(owned.fixture, owned.work);
          assert.equal(result.ok, false, "admission should reject coherent archive forgery");
          assert.match(result.message, /pnpm metadata|compressed archive digest differs/);
        } finally {
          await fs.writeFile(archive, originalArchive);
          await fs.writeFile(receiptFile, receipt);
        }
        assert.deepEqual(await fs.readFile(archive), originalArchive);
        assert.deepEqual(await fs.readFile(receiptFile), receipt);
        await runAdmission(owned.fixture, owned.work);
      },
    );
  });
});
