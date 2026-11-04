import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const FIXTURE_PATH = path.join(repositoryRoot, "test", "fixtures", "declared-tool-contracts.json");
const SMOKE_PATH = path.join(repositoryRoot, "scripts", "dsh-adapter-smoke.mjs");

async function readFixture(): Promise<{ baseline: string; tools: Record<string, unknown> }> {
  return JSON.parse(await readFile(FIXTURE_PATH, "utf8"));
}

describe("declared tool contracts fixture", () => {
  it("committed fixture baseline equals PUBLIC_BASELINE_VERSION in the smoke source", async () => {
    const source = await readFile(SMOKE_PATH, "utf8");
    const match = /const PUBLIC_BASELINE_VERSION = "([^"]+)"/u.exec(source);
    expect(match?.[1]).toBe("0.13.0");
    const fixture = await readFixture();
    expect(fixture.baseline).toBe(match?.[1]);
    expect(Object.keys(fixture).sort()).toEqual(["baseline", "tools"]);
  });
});
