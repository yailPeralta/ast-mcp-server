import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { acquirePinnedSource, trustedGit } from "./prepare-harness.mjs";

test.beforeEach((t) => {
  const umask = process.umask(0o077);
  t.after(() => process.umask(umask));
});

async function temporary(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "ast103-acquisition-")));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
    await assert.rejects(fs.lstat(root), { code: "ENOENT" });
  });
  return root;
}

async function graph(t) {
  const root = await temporary(t);
  const origin = path.join(root, "origin");
  await trustedGit(["init", "--object-format=sha1", origin], root);
  const revisions = [];
  for (const content of ["ancestor", "pinned", "future"]) {
    await fs.writeFile(path.join(origin, "source"), `${content}\n`);
    await fs.writeFile(path.join(origin, "executable"), `#!/bin/sh\necho ${content}\n`);
    await fs.chmod(path.join(origin, "executable"), 0o700);
    await trustedGit(["add", "."], origin);
    await trustedGit(
      [
        "-c",
        "user.name=Acquisition",
        "-c",
        "user.email=test@example.invalid",
        "commit",
        "-m",
        content,
      ],
      origin,
    );
    revisions.push((await trustedGit(["rev-parse", "HEAD"], origin)).trim());
  }
  return { root, origin, upstream: pathToFileURL(origin).href, revisions };
}

test("acquires only the exact middle commit with complete independent sources", async (t) => {
  const { root, origin, upstream, revisions } = await graph(t);
  const [ancestor, pinned, future] = revisions;
  const tree = (await trustedGit(["rev-parse", `${pinned}^{tree}`], origin)).trim();
  const controls = [];
  for (const variant of ["baseline", "candidate"]) {
    const cwd = path.join(root, variant);
    await acquirePinnedSource(upstream, pinned, cwd);
    assert.equal(
      (await trustedGit(["rev-parse", "HEAD", "HEAD^{tree}"], cwd)).trim(),
      `${pinned}\n${tree}`,
    );
    assert.equal(await fs.readFile(path.join(cwd, ".git/HEAD"), "utf8"), `${pinned}\n`);
    assert.equal(
      (await trustedGit(["remote", "get-url", "--all", "origin"], cwd)).trim(),
      upstream,
    );
    assert.equal(await fs.readFile(path.join(cwd, "source"), "utf8"), "pinned\n");
    assert.equal(
      await fs.readFile(path.join(cwd, "executable"), "utf8"),
      "#!/bin/sh\necho pinned\n",
    );
    assert.equal((await fs.lstat(path.join(cwd, "source"))).mode & 0o111, 0);
    assert.equal((await fs.lstat(path.join(cwd, "executable"))).mode & 0o100, 0o100);
    await trustedGit(["diff", "--exit-code", "HEAD"], cwd);
    const control = await fs.lstat(path.join(cwd, ".git"));
    assert.ok(control.isDirectory());
    controls.push(`${control.dev}:${control.ino}`);
    for (const name of [
      "objects/info/alternates",
      "objects/info/http-alternates",
      "commondir",
      "gitdir",
    ])
      await assert.rejects(fs.lstat(path.join(cwd, ".git", name)), { code: "ENOENT" });
    assert.equal((await trustedGit(["rev-parse", "--show-object-format"], cwd)).trim(), "sha1");
    assert.equal((await trustedGit(["rev-parse", "--is-shallow-repository"], cwd)).trim(), "true");
    assert.equal(await fs.readFile(path.join(cwd, ".git/shallow"), "utf8"), `${pinned}\n`);
    assert.equal((await trustedGit(["rev-list", "--all"], cwd)).trim(), pinned);
    for (const absent of [ancestor, future])
      await assert.rejects(trustedGit(["cat-file", "-e", absent], cwd), /exited with 1/);
    assert.ok(
      !(await fs.readdir(path.join(cwd, ".git/objects/pack"))).some((name) =>
        name.endsWith(".promisor"),
      ),
    );
  }
  assert.notEqual(...controls);
});

test("occupied acquisition destinations remain caller-owned and unchanged", async (t) => {
  const { root, upstream, revisions } = await graph(t);
  for (const occupied of ["empty", "directory", "file"]) {
    const cwd = path.join(root, occupied);
    if (occupied === "file") await fs.writeFile(cwd, "preserve");
    else {
      await fs.mkdir(cwd);
      if (occupied === "directory") await fs.writeFile(path.join(cwd, "sentinel"), "preserve");
    }
    const before = await fs.lstat(cwd);
    await assert.rejects(acquirePinnedSource(upstream, revisions[1], cwd), { code: "EEXIST" });
    assert.deepEqual(await fs.lstat(cwd), before);
    if (occupied === "empty") assert.deepEqual(await fs.readdir(cwd), []);
    else {
      const file = occupied === "file" ? cwd : path.join(cwd, "sentinel");
      assert.equal(await fs.readFile(file, "utf8"), "preserve");
      if (occupied === "directory") assert.deepEqual(await fs.readdir(cwd), ["sentinel"]);
    }
  }
});

test("unavailable exact pin leaves partial acquisition for its caller to clean", async (t) => {
  const { root, upstream } = await graph(t);
  const cwd = path.join(root, "unavailable");
  const missing = "0".repeat(40);
  await assert.rejects(acquirePinnedSource(upstream, missing, cwd), (error) => {
    assert.match(error.message, /Git request .*fetch.*--depth=1/);
    assert.match(error.stderr, /not our ref/);
    assert.match(error.cause.message, /exited with 128/);
    return true;
  });
  assert.ok((await fs.lstat(path.join(cwd, ".git"))).isDirectory());
  assert.equal((await trustedGit(["remote", "get-url", "--all", "origin"], cwd)).trim(), upstream);
  await assert.rejects(fs.lstat(path.join(cwd, "source")), { code: "ENOENT" });
  await fs.rm(cwd, { recursive: true });
  await assert.rejects(fs.lstat(cwd), { code: "ENOENT" });
  assert.ok((await fs.lstat(path.join(root, "origin/.git"))).isDirectory());
});

test("native occupied clone error retains direct stream fields without contacting a remote", async (t) => {
  const root = await temporary(t);
  const cwd = path.join(root, "occupied");
  await fs.mkdir(cwd);
  await fs.writeFile(path.join(cwd, "sentinel"), "preserve");
  await assert.rejects(
    trustedGit(["clone", "--", "https://example.invalid/repo", cwd], root),
    (error) => {
      assert.match(error.message, /Git request .*clone.*occupied/);
      assert.match(error.cause.message, /exited with 128/);
      assert.match(error.stderr, /already exists/);
      assert.equal(error.stdout, "");
      assert.equal(error.stderr, error.cause.stderr);
      assert.equal(error.stdout, error.cause.stdout);
      for (const key of Object.keys(error.cause)) assert.equal(error[key], error.cause[key]);
      return true;
    },
  );
  assert.deepEqual(await fs.readdir(cwd), ["sentinel"]);
  assert.equal(await fs.readFile(path.join(cwd, "sentinel"), "utf8"), "preserve");
});

test("trusted Git attributes a bounded sanitized failed request and retains its cause", async (t) => {
  const cwd = await temporary(t);
  assert.match(await trustedGit(["--version"], cwd), /^git version /);
  const url = "https://sensitive:sensitive@example.invalid/repo?sensitive=yes#sensitive";
  const args = ["clone", "--invalid-ast103-option", "--", url, "candidate"];
  args.push("https://example.invalid/?sensitive", "Bearer sensitive", "x".repeat(4096));
  await assert.rejects(trustedGit(args, cwd), (error) => {
    assert.match(error.message, /Git request .*clone.*\[REDACTED URL\].*candidate/);
    assert.doesNotMatch(error.message, /sensitive/);
    assert.ok(error.message.length < 1600);
    assert.ok(error.cause instanceof Error);
    assert.match(error.cause.message, /exited with 129/);
    assert.ok(error.message.endsWith(error.cause.message));
    assert.match(error.cause.stderr, /unknown option/);
    assert.equal(error.cause.stdout, "");
    assert.equal(error.stdout, error.cause.stdout);
    assert.equal(error.stderr, error.cause.stderr);
    assert.equal(Object.hasOwn(error, "exitCode"), false);
    return true;
  });
});
