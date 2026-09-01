import { Project } from "ts-morph";
import { describe, expect, it } from "vitest";
import {
  buildDiagnosticAggregates,
  buildEditContext,
  compareDiagnostics,
  DIAGNOSTIC_AGGREGATE_GROUP_LIMIT,
  observeDiagnostic,
  type DiagnosticAggregateMetadata,
  type DiagnosticAggregates,
  type EditBudget,
  type NormalizedDiagnostic,
} from "../src/services/diagnostics.js";
import { RequestContextError, type RequestContext } from "../src/services/request-context.js";

function diagnostic(overrides: Partial<NormalizedDiagnostic> = {}): NormalizedDiagnostic {
  return {
    code: 2322,
    category: "Error",
    file: "src/value.ts",
    line: 1,
    column: 1,
    message: "Type 'string' is not assignable to type 'number'.",
    ...overrides,
  };
}

describe("diagnostic observations and edit context", () => {
  it("observes compiler spans in JavaScript UTF-16 code units", () => {
    const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
    const text = 'const emoji = "😀";\nconst value: number = "x";';
    project.createSourceFile("/project/value.ts", text);
    const compilerDiagnostic = project.getPreEmitDiagnostics()[0]!;
    const observed = observeDiagnostic(compilerDiagnostic, "/project", 7);
    expect(observed).toMatchObject({ start: text.indexOf("value"), length: 5, ordinal: 7 });
    expect(observed.public).not.toHaveProperty("start");
    expect(observed.public).not.toHaveProperty("length");
  });
  it.each([
    [
      "insertion",
      "ab",
      "aXb",
      [
        [0, 1, 0, 1],
        [1, 2, 2, 3],
      ],
      [[1, 1, 1, 2]],
    ],
    [
      "deletion",
      "aXb",
      "ab",
      [
        [0, 1, 0, 1],
        [2, 3, 1, 2],
      ],
      [[1, 2, 1, 1]],
    ],
    [
      "replacement",
      "abc",
      "aXc",
      [
        [0, 1, 0, 1],
        [2, 3, 2, 3],
      ],
      [[1, 2, 1, 2]],
    ],
    [
      "multiple edits",
      "abcde",
      "aXbcYe",
      [
        [0, 1, 0, 1],
        [1, 3, 2, 4],
        [4, 5, 5, 6],
      ],
      [
        [1, 1, 1, 2],
        [3, 4, 4, 5],
      ],
    ],
  ])("builds maximal ordered runs for %s", (_name, oldText, newText, runs, hunks) => {
    const context = buildEditContext(oldText, newText);
    expect(context.coarse).toBe(false);
    expect(context.runs.map((run) => Object.values(run))).toEqual(runs);
    expect(context.hunks.map((hunk) => Object.values(hunk))).toEqual(hunks);
  });
  it("uses a stable deletion-first tie-break for repeated text", () => {
    const expected = buildEditContext("ABAB", "BABA");
    expect(expected).toEqual(buildEditContext("ABAB", "BABA"));
    expect(expected.runs).toEqual([{ oldStart: 1, oldEnd: 4, newStart: 0, newEnd: 3 }]);
    expect(expected.hunks).toEqual([
      { oldStart: 0, oldEnd: 1, newStart: 0, newEnd: 0 },
      { oldStart: 4, oldEnd: 4, newStart: 3, newEnd: 4 },
    ]);
  });

  it.each(["frontierSteps", "traceCells", "hunks"] as const)(
    "falls back to a conservative maximal-prefix/suffix hunk at the %s cap",
    (cap) => {
      const budget: EditBudget = { frontierSteps: 100, traceCells: 100, hunks: 100, [cap]: 0 };
      expect(buildEditContext("PabcS", "PxyzS", budget)).toEqual({
        coarse: true,
        runs: [
          { oldStart: 0, oldEnd: 1, newStart: 0, newEnd: 1 },
          { oldStart: 4, oldEnd: 5, newStart: 4, newEnd: 5 },
        ],
        hunks: [{ oldStart: 1, oldEnd: 4, newStart: 1, newEnd: 4 }],
      });
    },
  );

  it("propagates typed cancellation from a deterministic mapping checkpoint", () => {
    let checkpoints = 0;
    const requestContext: RequestContext = {
      signal: new AbortController().signal,
      checkpoint() {
        if (++checkpoints === 2) throw new RequestContextError("REQUEST_CANCELLED");
      },
    };
    expect(() => buildEditContext("abc", "xyz", undefined, requestContext)).toThrowError(
      expect.objectContaining({ code: "REQUEST_CANCELLED" }),
    );
    expect(checkpoints).toBe(2);
  });
});

describe("diagnostic deltas", () => {
  it("does not classify a shifted existing diagnostic as new", () => {
    const before = [diagnostic({ line: 1 })];
    const after = [diagnostic({ line: 12 })];
    expect(compareDiagnostics(before, after)).toEqual({
      added: [],
      removed: [],
      addedErrors: [],
    });
  });

  it("uses multiset counts so an additional identical error is detected", () => {
    const existing = diagnostic();
    const added = diagnostic({ line: 2 });
    const delta = compareDiagnostics([existing], [existing, added]);
    expect(delta.added).toEqual([added]);
    expect(delta.addedErrors).toEqual([added]);
  });
});

function expectExactEquations(aggregates: DiagnosticAggregates, total: number): void {
  function expectDimension(
    dimension: DiagnosticAggregateMetadata & { groups: { count: number }[] },
    unfiled = 0,
  ): void {
    expect(dimension.groups).toHaveLength(
      dimension.total_group_count - dimension.omitted_group_count,
    );
    expect(dimension.groups.reduce((sum, group) => sum + group.count, 0)).toBe(
      dimension.covered_diagnostic_count,
    );
    expect(dimension.covered_diagnostic_count + dimension.omitted_diagnostic_count + unfiled).toBe(
      total,
    );
    expect(dimension.truncated).toBe(dimension.omitted_group_count > 0);
  }

  expectDimension(aggregates.codes);
  expectDimension(aggregates.files, aggregates.files.unfiled_diagnostic_count);
}

function interruptAt(target: number): RequestContext {
  let checkpoints = 0;
  return {
    signal: new AbortController().signal,
    checkpoint(): void {
      checkpoints += 1;
      if (checkpoints === target) throw new Error(`checkpoint:${target}`);
    },
  };
}

describe("diagnostic aggregates", () => {
  it("returns exact empty aggregates", () => {
    expect(buildDiagnosticAggregates([])).toEqual({
      group_limit: DIAGNOSTIC_AGGREGATE_GROUP_LIMIT,
      codes: {
        groups: [],
        total_group_count: 0,
        omitted_group_count: 0,
        covered_diagnostic_count: 0,
        omitted_diagnostic_count: 0,
        truncated: false,
      },
      files: {
        groups: [],
        total_group_count: 0,
        omitted_group_count: 0,
        covered_diagnostic_count: 0,
        omitted_diagnostic_count: 0,
        unfiled_diagnostic_count: 0,
        truncated: false,
      },
    });
  });

  it("counts null files separately and orders tied groups deterministically", () => {
    const input = [
      diagnostic({ code: 300, file: null }),
      diagnostic({ code: 200, file: "src/a.ts" }),
      diagnostic({ code: 100, file: "src/b.ts" }),
      diagnostic({ code: 100, file: "src/b.ts" }),
      diagnostic({ code: 400, file: "src/c.ts" }),
    ];

    const aggregates = buildDiagnosticAggregates(input);
    expect(aggregates.codes.groups).toEqual([
      { code: 100, count: 2 },
      { code: 200, count: 1 },
      { code: 300, count: 1 },
      { code: 400, count: 1 },
    ]);
    expect(aggregates.files.groups).toEqual([
      { file: "src/b.ts", count: 2 },
      { file: "src/a.ts", count: 1 },
      { file: "src/c.ts", count: 1 },
    ]);
    expect(aggregates.files.unfiled_diagnostic_count).toBe(1);
    expect(buildDiagnosticAggregates(input)).toEqual(aggregates);
    expectExactEquations(aggregates, input.length);
  });

  it.each([
    ["at", DIAGNOSTIC_AGGREGATE_GROUP_LIMIT, false, 0],
    ["over", DIAGNOSTIC_AGGREGATE_GROUP_LIMIT + 1, true, 1],
  ])("handles the %s-cap boundary", (_label, count, truncated, omitted) => {
    const input = Array.from({ length: count }, (_, index) =>
      diagnostic({ code: 100 + index, file: `src/${String(index).padStart(2, "0")}.ts` }),
    );
    const aggregates = buildDiagnosticAggregates(input);

    expect(aggregates.codes.groups.map(({ code }) => code)).toEqual(
      Array.from({ length: Math.min(count, 20) }, (_, index) => 100 + index),
    );
    expect(aggregates.files.groups.map(({ file }) => file)).toEqual(
      Array.from(
        { length: Math.min(count, 20) },
        (_, index) => `src/${String(index).padStart(2, "0")}.ts`,
      ),
    );
    for (const dimension of [aggregates.codes, aggregates.files]) {
      expect(dimension.truncated).toBe(truncated);
      expect(dimension.omitted_group_count).toBe(omitted);
      expect(dimension.omitted_diagnostic_count).toBe(omitted);
    }
    expectExactEquations(aggregates, input.length);
  });

  it("checks cancellation initially, while counting, and while ranking", () => {
    const twoGroups = [diagnostic({ code: 1 }), diagnostic({ code: 2 })];
    expect(() => buildDiagnosticAggregates([], interruptAt(1))).toThrow("checkpoint:1");
    expect(() => buildDiagnosticAggregates([diagnostic()], interruptAt(2))).toThrow("checkpoint:2");
    expect(() => buildDiagnosticAggregates(twoGroups, interruptAt(4))).toThrow("checkpoint:4");
    expect(() => buildDiagnosticAggregates(twoGroups, interruptAt(6))).toThrow("checkpoint:6");
  });
});
