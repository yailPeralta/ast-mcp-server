import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectInstalledAgents } from "../src/services/agent-setup.js";
import { agentsToProbe } from "../src/services/setup-wizard.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

// Every fake client records its own invocation, so a probe of an unrequested client is observable.
async function createRecordingClients(clients: readonly string[]): Promise<{
  bin: string;
  home: string;
  probeLog: string;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), "ast-setup-probing-"));
  temporaryDirectories.push(root);
  const bin = path.join(root, "bin");
  const home = path.join(root, "home");
  const probeLog = path.join(root, "probes.log");
  await mkdir(bin);
  await mkdir(home);
  await writeFile(probeLog, "", "utf8");
  for (const client of clients) {
    const executable = path.join(bin, client);
    await writeFile(
      executable,
      '#!/bin/sh\necho "${0##*/} $*" >> "$AST_TEST_PROBE_LOG"\necho "0.0.0"\n',
      "utf8",
    );
    await chmod(executable, 0o755);
  }
  return { bin, home, probeLog };
}

async function readProbes(probeLog: string): Promise<string[]> {
  return (await readFile(probeLog, "utf8")).split("\n").filter(Boolean).sort();
}

describe("setup agent probing", () => {
  it("probes only the requested agents when a selection is given", async () => {
    const fake = await createRecordingClients(["claude", "gemini", "opencode"]);
    const environment = { PATH: fake.bin, HOME: fake.home, AST_TEST_PROBE_LOG: fake.probeLog };

    const detections = await detectInstalledAgents({ environment, agents: ["claude"] });

    expect(detections.map((item) => item.id)).toEqual(["claude"]);
    expect(await readProbes(fake.probeLog)).toEqual(["claude --version"]);
  });

  it("probes every agent when no selection is given", async () => {
    const fake = await createRecordingClients(["claude", "gemini", "opencode"]);
    const environment = { PATH: fake.bin, HOME: fake.home, AST_TEST_PROBE_LOG: fake.probeLog };

    const detections = await detectInstalledAgents({ environment });

    expect(detections).toHaveLength(6);
    expect(await readProbes(fake.probeLog)).toEqual([
      "claude --version",
      "gemini --version",
      "opencode --version",
    ]);
  });

  it("limits the probe to an explicit selection and keeps it complete otherwise", () => {
    expect(agentsToProbe(["claude"])).toEqual(["claude"]);
    // Both of these have to discover what is installed before they can choose.
    expect(agentsToProbe({ mode: "all" })).toBeUndefined();
    expect(agentsToProbe(undefined)).toBeUndefined();
  });
});
