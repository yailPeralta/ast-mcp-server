import { chmod, mkdtemp, open, readFile, rm, writeFile, type FileHandle } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  probePublicationCapability,
  publishAuthenticated,
  rollbackOwnedCommit,
  snapshotHeldFile,
  type PublicationPlan,
} from "../src/services/authenticated-publication.js";
const roots: string[] = [],
  handles: FileHandle[] = [];
afterEach(async () => {
  await Promise.allSettled(handles.splice(0).map((handle) => handle.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function ownedRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "authenticated-publication-"));
  const directory = await open(root, "r");
  roots.push(root);
  handles.push(directory);
  return { root, directory };
}
async function replacement(): Promise<{ root: string; plan: PublicationPlan }> {
  const { root, directory } = await ownedRoot();
  await writeFile(path.join(root, "destination"), "preimage");
  await writeFile(path.join(root, "stage"), "postimage");
  const preimage = await open(path.join(root, "destination"), "r");
  const stage = await open(path.join(root, "stage"), "r");
  handles.push(preimage, stage);
  return {
    root,
    plan: {
      kind: "replacement" as const,
      directory,
      destinationBasename: "destination",
      stage,
      stageBasename: "stage",
      stageIdentity: await snapshotHeldFile(stage),
      preimage,
      preimageIdentity: await snapshotHeldFile(preimage),
    },
  };
}
const linuxIt = it.runIf(process.platform === "linux");
linuxIt("does not clobber a competing creation", async () => {
  const { root, directory } = await ownedRoot();
  await probePublicationCapability(root);
  await writeFile(path.join(root, "stage"), "postimage");
  const stage = await open(path.join(root, "stage"), "r");
  handles.push(stage);
  const result = await publishAuthenticated({
    kind: "creation",
    directory,
    destinationBasename: "destination",
    stage,
    stageBasename: "stage",
    stageIdentity: await snapshotHeldFile(stage),
    beforePublish: () => writeFile(path.join(root, "destination"), "external"),
  });
  expect(result).toEqual({ state: "pre_effect", reason: "conflict" });
  expect(await readFile(path.join(root, "destination"), "utf8")).toBe("external");
});
linuxIt.each(["substitution", "same-inode edit", "exact rollback", "lost proof"] as const)(
  "handles replacement %s",
  async (scenario) => {
    const fixture = await replacement();
    if (scenario === "substitution" || scenario === "same-inode edit") {
      fixture.plan.beforePublish = async () => {
        if (scenario === "substitution") await rm(path.join(fixture.root, "destination"));
        await writeFile(path.join(fixture.root, "destination"), "external");
        if (scenario === "same-inode edit")
          await chmod(path.join(fixture.root, "destination"), 0o600);
      };
      expect(await publishAuthenticated(fixture.plan)).toEqual({
        state: "rolled_back",
        reason: "conflict",
      });
      expect(await readFile(path.join(fixture.root, "destination"), "utf8")).toBe("external");
      if (scenario === "same-inode edit")
        expect(await snapshotHeldFile(fixture.plan.preimage!)).toMatchObject({ mode: 0o600 });
      return;
    }
    const result = await publishAuthenticated(fixture.plan);
    if (result.state !== "committed") throw new Error("expected replacement commit");
    const loseProof = scenario === "lost proof";
    const rollback = await rollbackOwnedCommit(result.token, {
      beforeRollback: loseProof
        ? async () => {
            await writeFile(path.join(fixture.root, "stage"), "external");
            await chmod(path.join(fixture.root, "stage"), 0o600);
          }
        : undefined,
    });
    expect(rollback).toEqual(
      loseProof
        ? { state: "ambiguous", phase: "rollback" }
        : { state: "rolled_back", reason: "conflict" },
    );
    expect(await readFile(path.join(fixture.root, "destination"), "utf8")).toBe(
      loseProof ? "postimage" : "preimage",
    );
    if (loseProof)
      expect(await readFile(path.join(fixture.root, "stage"), "utf8")).toBe("external");
  },
);
