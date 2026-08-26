import { afterEach, expect, it, vi } from "vitest";
import path from "node:path";
import { runSupervisedWorkerEvidence } from "../scripts/canary-local-mcp.mjs";
import { prepareRename, clearOperationsForTests } from "../src/services/operations.js";
import {
  clearProjectSessions,
  getProjectRuntimeShutdownSnapshot,
} from "../src/services/project.js";
import { createProjectFixture, type ProjectFixture } from "./helpers/project-fixture.js";

let fixture: ProjectFixture | undefined;
// prettier-ignore
afterEach(async () => { clearOperationsForTests(); clearProjectSessions(); await fixture?.cleanup(); fixture = undefined; vi.unstubAllEnvs(); });

// prettier-ignore
it("pins a real compiler generation after retaining mutation history", async () => {
  vi.stubEnv("AST_SYMBOL_INDEX_PERSISTENCE", "disabled"); fixture = await createProjectFixture({ "src/value.ts": "export function value(input: number) { return input; }\n", "src/use.ts": 'import { value } from "./value.js"; export const used = value(1);\n' });
  await prepareRename({ projectRoot: fixture.root, filePath: "src/value.ts", symbolPath: "value", newName: "renamed" }); expect(getProjectRuntimeShutdownSnapshot()).toMatchObject({ admission: "open", mutation_history: true });
});

it("proves supervised parity, aggregate cancellation, PSS reclamation, and redaction", async () => {
  const files = Object.fromEntries(
    Array.from({ length: 400 }, (_, index) => [
      `src/evidence-${index}.ts`,
      index === 0
        ? "export const evidenceValue0: string = 0;\n"
        : `export const evidenceValue${index} = ${index};\n`,
    ]),
  );
  fixture = await createProjectFixture(files);

  const evidence = await runSupervisedWorkerEvidence({
    nodeBin: process.execPath,
    projectRoot: fixture.root,
    cacheRoot: path.join(fixture.root, ".evidence-cache"),
  });

  expect(evidence).toMatchObject({
    schema_version: 1,
    parent_count: 3,
    cycles_per_parent: 3,
    equivalent_reads: true,
    stable_fingerprint: true,
    sqlite_hits: 6,
    reused_files: 400,
    rebuilt_files: 0,
    no_upward_pss_trend: true,
    diagnostics_redacted: true,
    aggregate_success: true,
    aggregate_equivalent_reads: true,
    aggregate_cancellation_in_process: true,
    aggregate_cancellation_supervised: true,
  });
  expect(evidence.minimum_reclaimed_percent).toBeGreaterThanOrEqual(80);
  expect(evidence.cycles).toHaveLength(9);
  expect(evidence.events).toHaveLength(9);
  expect(JSON.stringify(evidence)).not.toMatch(
    new RegExp(`${fixture.root}|credential-secret|NODE_OPTIONS`, "i"),
  );
  for (const event of evidence.events) {
    expect(Object.keys(event).sort()).toEqual(
      Object.keys(event)
        .filter((key) =>
          ["event", "version", "kind", "generation", "correlation_id", "count"].includes(key),
        )
        .sort(),
    );
    expect(Buffer.byteLength(JSON.stringify(event))).toBeLessThanOrEqual(512);
  }
});
