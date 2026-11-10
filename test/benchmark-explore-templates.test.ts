import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { clearProjectSessions } from "../src/services/project.js";
import { ANGULAR_FIXTURE_ROOT, createAngularFixture } from "./helpers/angular-fixture.js";
import { generateMatrixProject } from "./helpers/angular-matrix-fixture.js";
import { createProjectFixture } from "./helpers/project-fixture.js";
// @ts-expect-error The benchmark is intentionally shipped as a standalone ESM script.
const { runExploreTemplateBenchmark } = await import("../scripts/benchmark-explore-templates.mjs");

describe("explore template latency benchmark", () => {
  // Shape only: a timing assertion here would make the suite depend on the machine.
  it("reports one baseline and one Angular case per fixture size", async () => {
    const report = await runExploreTemplateBenchmark({
      widgets: [3],
      runs: 1,
      createServer,
      clearProjectSessions,
      generateMatrixProject,
      createAngularFixture: (files: Record<string, string>) =>
        createAngularFixture(files, { compiler: "v21" }),
      createBaselineFixture: (files: Record<string, string>) =>
        createProjectFixture(files, { parentDir: ANGULAR_FIXTURE_ROOT }),
    });

    expect(report.request).toEqual({ query: "label", detail: "full", limit: 20 });
    expect(report.runs).toBe(1);
    expect(report.cases.map((item: { name: string }) => item.name)).toEqual([
      "baseline-9",
      "angular-9",
    ]);
    for (const item of report.cases) {
      expect(item).toEqual({
        name: expect.any(String),
        components: 9,
        symbols: 3,
        cold_ms: expect.any(Number),
        p50_ms: expect.any(Number),
        p95_ms: expect.any(Number),
        peak_rss_bytes: expect.any(Number),
        typed_result: true,
        coverage: expect.any(Object),
      });
    }
    const [baseline, angular] = report.cases;
    expect(baseline.coverage).toEqual({});
    expect(angular.coverage).toEqual({ completed: 3 });
    expect(report.added).toEqual([
      { components: 9, added_p50_ms: expect.any(Number), added_p95_ms: expect.any(Number) },
    ]);
  });
});
