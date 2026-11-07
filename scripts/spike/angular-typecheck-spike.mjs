#!/usr/bin/env node
// Spike for #421: can ngtsc type-check Angular templates for a rename plan from a one-shot
// child process, using only the public `@angular/compiler-cli` entry?
//
//   node scripts/spike/angular-typecheck-spike.mjs --all            gates G1-G9 on majors 18-22
//   node scripts/spike/angular-typecheck-spike.mjs --major 20       one major
//   options: --runs 10 --components 100 --json <file> --skip-timing
//
// Needs Node with native TypeScript type stripping (>=22.18) because it imports the fixture
// generator from test/helpers. Exit code: 0 proceed, 1 stop, 2 harness error.
import { execFileSync, fork } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { performance } from "node:perf_hooks";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath, pathToFileURL } from "node:url";

const SELF = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(SELF), "..", "..");
const matrixRoot = path.join(repositoryRoot, "test", "angular-matrix");
const MAJORS = [18, 19, 20, 21, 22];
const HEAP_MB = 1024;
const MAX_ADDED_LATENCY_MS = 10_000;
const MAX_RSS_BYTES = 1024 * 1024 * 1024;
const CHILD_TIMEOUT_MS = 180_000;

// ---------------------------------------------------------------- child side

async function runCheck(request) {
  const requireFromWorkspace = createRequire(path.join(request.workspace, "package.json"));
  const cliEntry = requireFromWorkspace.resolve("@angular/compiler-cli");
  const cliPackage = requireFromWorkspace.resolve("@angular/compiler-cli/package.json");
  const cliVersion = JSON.parse(readFileSync(cliPackage, "utf8")).version;
  const tsEntry = request.altTs ?? createRequire(cliPackage).resolve("typescript");
  if (request.altTs) {
    registerHooks({
      resolve(specifier, context, nextResolve) {
        if (specifier === "typescript") {
          return { url: pathToFileURL(request.altTs).href, format: "commonjs", shortCircuit: true };
        }
        return nextResolve(specifier, context);
      },
    });
  }
  const ts = (await import(pathToFileURL(tsEntry).href)).default;
  const cli = await import(pathToFileURL(cliEntry).href);

  const api = {
    NgtscProgram: typeof cli.NgtscProgram,
    OptimizeFor: typeof cli.OptimizeFor,
    readConfiguration: typeof cli.readConfiguration,
    getTemplateTypeCheckerModuleExport: typeof cli.getTemplateTypeChecker,
  };
  const reply = { ok: true, cliVersion, tsVersion: ts.version, api, timings: {}, writeCalls: 0 };

  const config = cli.readConfiguration(path.join(request.root, "tsconfig.json"));
  if (config.errors.length > 0)
    throw new Error(`readConfiguration: ${config.errors.length} errors`);
  const options = {
    ...config.options,
    noEmit: true,
    incremental: false,
    composite: false,
    tsBuildInfoFile: undefined,
    // Internal ngtsc flag: getTemplateTypeChecker() throws without it. See the spike findings.
    ...(request.via === "checker" ? { _enableTemplateTypeChecker: true } : {}),
  };

  const sourceFiles = new Map();
  const overlay = new Map(request.overlay.map((entry) => [entry.abs, entry.text]));
  const makeHost = (withOverlay) => {
    const tsHost = ts.createCompilerHost(options, true);
    const read = tsHost.readFile.bind(tsHost);
    const exists = tsHost.fileExists.bind(tsHost);
    const getSourceFile = tsHost.getSourceFile.bind(tsHost);
    tsHost.writeFile = () => {
      reply.writeCalls += 1;
    };
    tsHost.readFile = (name) => (withOverlay && overlay.has(name) ? overlay.get(name) : read(name));
    tsHost.fileExists = (name) => (withOverlay && overlay.has(name)) || exists(name);
    tsHost.getSourceFile = (name, languageVersion, ...rest) => {
      if (withOverlay && overlay.has(name)) {
        return ts.createSourceFile(name, overlay.get(name), languageVersion, true);
      }
      if (!sourceFiles.has(name))
        sourceFiles.set(name, getSourceFile(name, languageVersion, ...rest));
      return sourceFiles.get(name);
    };
    return cli.createCompilerHost({ options, tsHost });
  };

  const check = async (withOverlay, oldProgram) => {
    const started = performance.now();
    const program = new cli.NgtscProgram(
      config.rootNames,
      options,
      makeHost(withOverlay),
      oldProgram,
    );
    await program.loadNgStructureAsync();
    const compiler = program.compiler;
    reply.api.getTemplateTypeCheckerOnCompiler = typeof compiler.getTemplateTypeChecker;
    reply.api.getComponentsWithTemplateFile = typeof compiler.getComponentsWithTemplateFile;
    const components = new Set();
    for (const template of request.templates) {
      for (const component of compiler.getComponentsWithTemplateFile(template))
        components.add(component);
    }
    let diagnostics;
    if (request.via === "checker") {
      const checker = compiler.getTemplateTypeChecker();
      diagnostics = [...components].flatMap((component) =>
        checker.getDiagnosticsForComponent(component),
      );
    } else {
      // Public api.Program path: whole-program Angular diagnostics, filtered to the scope files.
      const scopeFiles = new Set([
        ...request.templates,
        ...[...components].map((c) => c.getSourceFile().fileName),
      ]);
      diagnostics = program
        .getNgSemanticDiagnostics()
        .filter((d) => d.file && scopeFiles.has(d.file.fileName));
    }
    const wire = diagnostics.map((diagnostic) => {
      const file = diagnostic.file;
      const start = diagnostic.start ?? null;
      const length = diagnostic.length ?? null;
      return {
        code: diagnostic.code,
        category: ts.DiagnosticCategory[diagnostic.category],
        file: file ? path.relative(request.root, file.fileName).split(path.sep).join("/") : null,
        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
        start,
        length,
        slice:
          file && start !== null && length !== null ? file.text.slice(start, start + length) : null,
        line: file && start !== null ? file.getLineAndCharacterOfPosition(start).line + 1 : null,
      };
    });
    return { program, wire, componentCount: components.size, ms: performance.now() - started };
  };

  const before = await check(false, undefined);
  reply.timings.beforeMs = before.ms;
  reply.componentsInScope = before.componentCount;
  reply.rootFiles = config.rootNames.length;
  reply.before = before.wire;
  const after = await check(true, request.reuse ? before.program : undefined);
  reply.timings.afterMs = after.ms;
  reply.after = after.wire;
  reply.maxRssBytes = process.resourceUsage().maxRSS * 1024;
  return reply;
}

async function childMain() {
  if (process.argv[3] === "oom") {
    const hog = [];
    for (;;) hog.push(new Array(1_000_000).fill(hog.length));
  }
  process.on("disconnect", () => process.exit(1));
  process.on("message", async (request) => {
    let reply;
    try {
      reply = await runCheck(request);
    } catch (error) {
      reply = { ok: false, error: String(error?.message ?? error).split("\n")[0] };
    }
    process.send(reply, () => process.exit(0));
  });
}

// --------------------------------------------------------------- parent side

function spawnChild(request, { heapMb = HEAP_MB, mode = "check" } = {}) {
  return new Promise((resolve) => {
    const started = performance.now();
    const child = fork(SELF, ["--child", mode], {
      execArgv: [`--max-old-space-size=${heapMb}`, "--no-warnings"],
      env: {},
      serialization: "advanced",
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    let reply = null;
    const timer = setTimeout(() => child.kill("SIGKILL"), CHILD_TIMEOUT_MS);
    child.on("message", (message) => {
      reply = message;
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ reply, code, signal, wallMs: performance.now() - started });
    });
    if (mode === "check") child.send(request);
  });
}

function hashTree(root) {
  const hash = createHash("sha256");
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else hash.update(path.relative(root, full)).update(readFileSync(full));
    }
  };
  walk(root);
  return hash.digest("hex");
}

function directorySize(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    total += entry.isDirectory() ? directorySize(full) : statSync(full).size;
  }
  return total;
}

const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
};

async function withFixture(major, project, run) {
  const { writeMatrixProject } = await import("../../test/helpers/angular-matrix-fixture.ts");
  const workspace = path.join(matrixRoot, `v${major}`);
  const root = path.join(
    workspace,
    ".tmp",
    `spike-${process.pid}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(root, { recursive: true });
  try {
    await writeMatrixProject(root, project);
    const abs = (relative) => path.join(root, ...relative.split("/"));
    const overlay = project.rename.overlay.map((entry) => ({
      abs: abs(entry.path),
      text: entry.text,
    }));
    const templates = overlay
      .filter((entry) => entry.abs.endsWith(".html"))
      .map((entry) => entry.abs);
    return await run({ workspace, root, overlay, templates, abs });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const keyOf = (d) => `${d.code}|${d.category}|${d.file}|${d.message}`;
const peerRange = (major) => {
  const cli = JSON.parse(
    readFileSync(
      path.join(
        matrixRoot,
        `v${major}`,
        "node_modules",
        "@angular",
        "compiler-cli",
        "package.json",
      ),
      "utf8",
    ),
  );
  return cli.peerDependencies.typescript;
};
const versionIn = (version, range) => {
  const [major, minor] = version.split(".").map(Number);
  const num = (text) => text.split(".").map(Number);
  return range.split(" ").every((part) => {
    const [lowerMajor, lowerMinor] = num(part.replace(/^[<>=]+/u, ""));
    const compare = Math.sign(major - lowerMajor || minor - lowerMinor);
    return part.startsWith(">=") ? compare >= 0 : compare < 0;
  });
};

async function gateRun(major, project, extra = {}) {
  return withFixture(major, project, async (ctx) => {
    const hashBefore = hashTree(ctx.root);
    const result = await spawnChild({
      workspace: ctx.workspace,
      root: ctx.root,
      overlay: ctx.overlay,
      templates: ctx.templates,
      reuse: true,
      via: "checker",
      ...extra,
    });
    return { ...result, workspaceUnchanged: hashTree(ctx.root) === hashBefore };
  });
}

async function runGates(major) {
  const { generateMatrixProject } = await import("../../test/helpers/angular-matrix-fixture.ts");
  const started = performance.now();
  const seeded = await gateRun(
    major,
    generateMatrixProject({ components: 3, seedBrokenConsumer: true, seedPreexistingError: true }),
  );
  const clean = await gateRun(major, generateMatrixProject({ components: 3 }));
  const gates = {};
  const s = seeded.reply;
  const c = clean.reply;
  if (!s?.ok || !c?.ok) {
    return {
      major,
      error: s?.error ?? c?.error ?? `child failed (code ${seeded.code}, signal ${seeded.signal})`,
      gates: {},
    };
  }

  gates.G1 = {
    pass:
      s.api.NgtscProgram === "function" &&
      s.api.OptimizeFor === "object" &&
      s.api.readConfiguration === "function" &&
      s.api.getTemplateTypeCheckerOnCompiler === "function" &&
      s.api.getComponentsWithTemplateFile === "function",
    detail: {
      moduleExports: s.api,
      note: "getTemplateTypeChecker is an instance method of program.compiler, not a module export",
    },
  };

  const beforeKeys = new Set(s.before.map(keyOf));
  const added = s.after.filter((d) => !beforeKeys.has(keyOf(d)));
  const brokenAdded = added.find(
    (d) => d.message.includes("headng") && d.file === "src/host-0-1.component.html",
  );
  const preBefore = s.before.find((d) => d.message.includes("nonexistent"));
  const preAfter = s.after.find((d) => d.message.includes("nonexistent"));
  const cleanAdded = c.after.filter((d) => !new Set(c.before.map(keyOf)).has(keyOf(d)));
  gates.G2 = {
    pass:
      Boolean(brokenAdded) &&
      added.length === 1 &&
      Boolean(preBefore) &&
      Boolean(preAfter) &&
      cleanAdded.length === 0 &&
      c.before.length === 0 &&
      c.after.length === 0 &&
      s.componentsInScope === 3,
    detail: {
      addedCount: added.length,
      brokenAdded: brokenAdded?.message ?? null,
      preexistingBeforeAfter: [preBefore?.start, preAfter?.start],
      cleanBefore: c.before.length,
      cleanAfter: c.after.length,
      componentsInScope: s.componentsInScope,
    },
  };

  // Informational: the same seeded scenario through the public api.Program path only, which needs
  // no internal `_enableTemplateTypeChecker` option (whole-program diagnostics filtered to scope).
  const viaProgram = await gateRun(
    major,
    generateMatrixProject({ components: 3, seedBrokenConsumer: true, seedPreexistingError: true }),
    { via: "program" },
  );
  const p = viaProgram.reply;
  const programBefore = new Set((p?.before ?? []).map(keyOf));
  const programAdded = (p?.after ?? []).filter((d) => !programBefore.has(keyOf(d)));
  gates.G2b = {
    informational: true,
    pass:
      Boolean(p?.ok) &&
      programAdded.length === 1 &&
      programAdded[0].message.includes("headng") &&
      p.before.length === 1,
    detail: {
      via: "program.getNgSemanticDiagnostics()",
      error: p?.error ?? null,
      added: programAdded.length,
      before: p?.before?.length ?? null,
    },
  };

  const htmlDiagnostics = [...s.before, ...s.after].filter((d) => d.file?.endsWith(".html"));
  gates.G4 = {
    pass:
      htmlDiagnostics.length >= 3 &&
      htmlDiagnostics.every((d) => d.slice !== null && /nonexistent|headng/u.test(d.slice)) &&
      preAfter.start - preBefore.start === 2,
    detail: {
      htmlDiagnostics: htmlDiagnostics.length,
      slices: [...new Set(htmlDiagnostics.map((d) => d.slice))],
      preexistingShift: preAfter.start - preBefore.start,
    },
  };

  gates.G7 = {
    pass:
      s.writeCalls === 0 &&
      c.writeCalls === 0 &&
      seeded.workspaceUnchanged &&
      clean.workspaceUnchanged,
    detail: {
      writeCalls: s.writeCalls + c.writeCalls,
      workspaceUnchanged: seeded.workspaceUnchanged && clean.workspaceUnchanged,
    },
  };

  const range = peerRange(major);
  const tsCandidates = MAJORS.map((m) => ({
    major: m,
    entry: path.join(matrixRoot, `v${m}`, "node_modules", "typescript", "lib", "typescript.js"),
  }));
  const pairs = [];
  for (const candidate of tsCandidates) {
    const version = JSON.parse(
      readFileSync(path.join(path.dirname(path.dirname(candidate.entry)), "package.json"), "utf8"),
    ).version;
    if (pairs.some((p) => p.ts === version)) continue;
    const run = await gateRun(major, generateMatrixProject({ components: 1 }), {
      altTs: candidate.entry,
    });
    const inRange = versionIn(version, range);
    const outcome = run.reply?.ok ? "works" : (run.reply?.error ?? "child failed");
    const versionError = /requires TypeScript/u.test(outcome);
    pairs.push({
      ts: version,
      inRange,
      outcome: versionError ? "typescript_incompatible" : outcome,
      ok: inRange ? outcome === "works" : versionError || outcome === "works",
    });
  }
  gates.G3 = {
    pass: pairs.every((p) => p.ok) && pairs.some((p) => p.inRange && p.outcome === "works"),
    detail: { peerRange: range, cli: s.cliVersion, pinnedTs: s.tsVersion, pairs },
  };
  return {
    major,
    gates,
    cliVersion: s.cliVersion,
    tsVersion: s.tsVersion,
    gateMs: performance.now() - started,
  };
}

async function runTiming(major, { runs, components, reuse, via = "checker" }) {
  const { generateMatrixProject } = await import("../../test/helpers/angular-matrix-fixture.ts");
  const project = generateMatrixProject({
    components,
    seedBrokenConsumer: true,
    seedPreexistingError: true,
  });
  const samples = [];
  for (let index = 0; index < runs; index += 1) {
    const run = await withFixture(major, project, (ctx) =>
      spawnChild({
        workspace: ctx.workspace,
        root: ctx.root,
        overlay: ctx.overlay,
        templates: ctx.templates,
        reuse,
        via,
      }),
    );
    if (!run.reply?.ok) {
      samples.push({ error: run.reply?.error ?? `exit ${run.code} ${run.signal}` });
      continue;
    }
    samples.push({
      rootFiles: run.reply.rootFiles,
      totalMs: run.wallMs,
      beforeMs: run.reply.timings.beforeMs,
      afterMs: run.reply.timings.afterMs,
      maxRssBytes: run.reply.maxRssBytes,
      added: run.reply.after.length,
      writeCalls: run.reply.writeCalls,
    });
  }
  const good = samples.filter((sample) => !sample.error);
  return {
    runs,
    rootFiles: good[0]?.rootFiles,
    failed: samples.length - good.length,
    errors: [...new Set(samples.filter((sample) => sample.error).map((sample) => sample.error))],
    totalMsP50: percentile(
      good.map((x) => x.totalMs),
      50,
    ),
    totalMsP95: percentile(
      good.map((x) => x.totalMs),
      95,
    ),
    beforeMsP50: percentile(
      good.map((x) => x.beforeMs),
      50,
    ),
    afterMsP50: percentile(
      good.map((x) => x.afterMs),
      50,
    ),
    peakRssBytes: Math.max(...good.map((x) => x.maxRssBytes)),
    writeCalls: good.reduce((sum, x) => sum + x.writeCalls, 0),
    samples: good.map((x) => Math.round(x.totalMs)),
  };
}

async function runCalibration(major, components) {
  const { generateMatrixProject } = await import("../../test/helpers/angular-matrix-fixture.ts");
  const project = generateMatrixProject({
    components,
    seedBrokenConsumer: true,
    seedPreexistingError: true,
  });
  const results = [];
  for (const heapMb of [256, 384, 512, 768, 1024]) {
    const run = await withFixture(major, project, (ctx) =>
      spawnChild(
        {
          workspace: ctx.workspace,
          root: ctx.root,
          overlay: ctx.overlay,
          templates: ctx.templates,
          reuse: true,
          via: "checker",
        },
        { heapMb },
      ),
    );
    results.push({
      heapMb,
      ok: Boolean(run.reply?.ok),
      exit: run.reply?.ok ? 0 : `${run.code ?? ""}${run.signal ?? ""}`,
    });
  }
  return results;
}

async function runOom() {
  const run = await spawnChild({}, { heapMb: 16, mode: "oom" });
  return { code: run.code, signal: run.signal, pass: run.code === 134 || run.signal === "SIGABRT" };
}

function git(...args) {
  try {
    return execFileSync("git", args, { cwd: repositoryRoot, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function parseArgs(argv) {
  const args = { majors: [], runs: 10, components: 100, json: null, timing: true };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--all") args.majors = [...MAJORS];
    else if (arg === "--major") args.majors.push(Number(argv[++index]));
    else if (arg === "--runs") args.runs = Number(argv[++index]);
    else if (arg === "--components") args.components = Number(argv[++index]);
    else if (arg === "--json") args.json = argv[++index];
    else if (arg === "--skip-timing") args.timing = false;
    else throw new Error(`unknown argument ${arg}`);
  }
  if (args.majors.length === 0 || args.majors.some((m) => !MAJORS.includes(m))) {
    throw new Error("pass --all or --major <18..22>");
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const out = (line) => process.stdout.write(`${line}\n`);
  const report = {
    machine: {
      cpu: os.cpus()[0]?.model,
      cores: os.cpus().length,
      memGiB: Math.round(os.totalmem() / 2 ** 30),
      platform: `${os.platform()} ${os.release()}`,
    },
    node: process.version,
    commit: git("rev-parse", "HEAD"),
    dirty: git("status", "--porcelain", "--untracked-files=no") !== "",
    heapMb: HEAP_MB,
    oom: await runOom(),
    majors: [],
  };
  for (const major of args.majors) {
    out(`== Angular ${major}`);
    const result = await runGates(major);
    result.installBytes = directorySize(path.join(matrixRoot, `v${major}`, "node_modules"));
    if (args.timing && !result.error) {
      result.timing = await runTiming(major, {
        runs: args.runs,
        components: args.components,
        reuse: true,
      });
      result.timingNoReuse = await runTiming(major, {
        runs: Math.min(5, args.runs),
        components: args.components,
        reuse: false,
      });
      result.timingProgramPath = await runTiming(major, {
        runs: Math.min(5, args.runs),
        components: args.components,
        reuse: true,
        via: "program",
      });
      result.gates.G6 = {
        informational: true,
        pass: result.timing.afterMsP50 < result.timingNoReuse.afterMsP50,
        detail: {
          afterWithOldProgramMsP50: result.timing.afterMsP50,
          afterColdMsP50: result.timingNoReuse.afterMsP50,
        },
      };
      result.calibration = await runCalibration(major, args.components);
    }
    report.majors.push(result);
    out(
      JSON.stringify({
        major,
        gates: Object.fromEntries(Object.entries(result.gates).map(([k, v]) => [k, v.pass])),
        timing: result.timing && {
          p50: Math.round(result.timing.totalMsP50),
          p95: Math.round(result.timing.totalMsP95),
          rssMiB: Math.round(result.timing.peakRssBytes / 2 ** 20),
          failed: result.timing.failed,
        },
        error: result.error,
      }),
    );
  }
  const failures = [];
  for (const result of report.majors) {
    if (result.error) failures.push(`v${result.major}: ${result.error}`);
    for (const [gate, value] of Object.entries(result.gates))
      if (!value.pass && !value.informational) failures.push(`v${result.major} ${gate}`);
    const timing = result.timing;
    if (timing) {
      if (timing.failed > 0) failures.push(`v${result.major} G8 failed runs: ${timing.failed}`);
      else if (timing.totalMsP95 > MAX_ADDED_LATENCY_MS)
        failures.push(`v${result.major} G8 p95 ${Math.round(timing.totalMsP95)} ms`);
      if (timing.peakRssBytes > MAX_RSS_BYTES)
        failures.push(`v${result.major} G8 rss ${Math.round(timing.peakRssBytes / 2 ** 20)} MiB`);
    }
  }
  if (!report.oom.pass)
    failures.push("G5 OOM signature not 134/SIGABRT (adjust exit mapping, not a stop)");
  report.verdict = failures.filter((f) => !f.startsWith("G5")).length === 0 ? "proceed" : "stop";
  report.failures = failures;
  if (args.json) writeFileSync(args.json, `${JSON.stringify(report, null, 2)}\n`);
  out(`verdict: ${report.verdict}${failures.length ? ` (${failures.join("; ")})` : ""}`);
  process.exitCode = report.verdict === "proceed" ? 0 : 1;
}

if (process.argv[2] === "--child") await childMain();
else {
  main().catch((error) => {
    process.stderr.write(`${error?.stack ?? error}\n`);
    process.exitCode = 2;
  });
}
