import { Project } from "ts-morph";
import { describe, expect, it } from "vitest";
import {
  buildDiagnosticAggregates,
  buildEditContext,
  compareDiagnostics,
  compareObservedDiagnostics,
  DIAGNOSTIC_AGGREGATE_GROUP_LIMIT,
  observeDiagnostic,
  type DiagnosticAggregateMetadata,
  type DiagnosticAggregates,
  type DiagnosticObservation,
  type DiagnosticTextChange,
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

function observation(
  start: number | null,
  length: number | null,
  overrides: Partial<NormalizedDiagnostic> = {},
  ordinal = 0,
): DiagnosticObservation {
  return { public: diagnostic(overrides), start, length, ordinal };
}

function change(
  beforeText: string | null,
  afterText: string | null,
  file = "src/value.ts",
): DiagnosticTextChange {
  return { file, beforeText, afterText };
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

describe("edit-aware diagnostic deltas", () => {
  it("maps disjoint repeated edits in CRLF, surrogate, and BOM-excluded compiler text", () => {
    const beforeText = "😀\r\nABAB--tail--end";
    const afterText = "X😀\r\nBABA--tail--end!";
    const before = [observation(beforeText.indexOf("tail"), 4)];
    const after = [observation(afterText.indexOf("tail"), 4, { line: 2, column: 6 })];
    expect(compareObservedDiagnostics(before, after, [change(beforeText, afterText)])).toEqual({
      added: [],
      removed: [],
      addedErrors: [],
    });
  });

  it.each([
    ["inside replacement", "abc", "aXc", 1, 1, 1, 1],
    ["intersects replacement", "abc", "aXc", 0, 2, 0, 2],
    ["abuts replacement left", "abc", "aXc", 0, 1, 0, 1],
    ["abuts replacement right", "abc", "aXc", 2, 1, 2, 1],
    ["zero-width insertion", "ab", "aXb", 1, 0, 1, 0],
    ["zero-width deletion", "aXb", "ab", 1, 0, 1, 0],
    ["missing start", "abc", "aXc", null, 1, null, 1],
    ["missing length", "abc", "aXc", 0, null, 0, null],
  ])("fails closed for %s", (_name, oldText, newText, oldStart, oldLength, newStart, newLength) => {
    const before = observation(oldStart, oldLength);
    const after = observation(newStart, newLength);
    expect(compareObservedDiagnostics([before], [after], [change(oldText, newText)])).toEqual({
      added: [after.public],
      removed: [before.public],
      addedErrors: [after.public],
    });
  });

  it("handles file lifecycle, unchanged files, and unfiled locations deterministically", () => {
    const created = observation(0, 1, { file: "src/new.ts", message: "created" });
    const deleted = observation(0, 1, { file: "src/old.ts", message: "deleted" });
    const stable = observation(null, null, { file: "src/stable.ts", message: "stable" });
    const oldSpan = observation(1, 1, { file: "src/stable.ts", message: "changed span" });
    const newSpan = observation(1, 2, { file: "src/stable.ts", message: "changed span" });
    const unfiled = observation(null, null, { file: null, line: null, column: null });
    const movedUnfiled = observation(null, null, { file: null, line: 1, column: 1 });
    const delta = compareObservedDiagnostics(
      [deleted, stable, oldSpan, unfiled],
      [created, stable, newSpan, movedUnfiled],
      [change(null, "x", "src/new.ts"), change("x", null, "src/old.ts")],
    );
    expect(delta.added).toEqual([created.public, newSpan.public, movedUnfiled.public]);
    expect(delta.removed).toEqual([deleted.public, oldSpan.public, unfiled.public]);
    expect(
      compareObservedDiagnostics(
        [deleted, stable, oldSpan, unfiled],
        [created, stable, newSpan, movedUnfiled],
        [change(null, "x", "src/new.ts"), change("x", null, "src/old.ts")],
      ),
    ).toEqual(delta);
  });

  it("matches duplicate candidates FIFO while preserving original output order", () => {
    const before = [1, 2, 3].map((line, ordinal) =>
      observation(2, 1, { line, message: "duplicate" }, ordinal),
    );
    const after = [
      observation(3, 1, { line: 10, message: "duplicate" }),
      observation(3, 1, { line: 11, message: "duplicate" }),
      observation(0, 1, { message: "first added" }),
      observation(4, 1, { message: "second added" }),
    ];
    const delta = compareObservedDiagnostics(before, after, [change("xab", "xxab")]);
    expect(delta.removed).toEqual([before[2]!.public]);
    expect(delta.added).toEqual([after[2]!.public, after[3]!.public]);
    expect(delta.addedErrors).toEqual(delta.added);
  });

  it("propagates typed cancellation during observation matching", () => {
    let checkpoints = 0;
    const requestContext: RequestContext = {
      signal: new AbortController().signal,
      checkpoint() {
        if (++checkpoints === 2) throw new RequestContextError("REQUEST_CANCELLED");
      },
    };
    expect(() =>
      compareObservedDiagnostics([observation(0, 1)], [observation(0, 1)], [], requestContext),
    ).toThrowError(expect.objectContaining({ code: "REQUEST_CANCELLED" }));
  });
});

describe("legacy diagnostic deltas", () => {
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
