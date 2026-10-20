import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, open, opendir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { Readable, Transform } from "node:stream";
import { clearTimeout, setTimeout } from "node:timers";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { t as listTar } from "tar";

const DEFAULT_LIMITS = Object.freeze({
  maxCompressedBytes: 8 * 1024 * 1024,
  maxInflatedBytes: 32 * 1024 * 1024,
  maxFileBytes: 16 * 1024 * 1024,
  maxEntries: 1024,
  maxPathBytes: 256,
  maxDepth: 16,
  inspectionDeadlineMs: 30_000,
  maxRetainedBytes: 32 * 1024 * 1024,
  maxRetainedEntries: 1024,
});

function blockedError(message) {
  return new Error(`BLOCKED: retained pnpm archive: ${message}`);
}

function blocked(message) {
  throw blockedError(message);
}

function mergeLimits(overrides = {}) {
  return { ...DEFAULT_LIMITS, ...overrides };
}

function checkpoint(signal) {
  if (signal?.aborted) throw signal.reason ?? new Error("retained archive inspection aborted");
}

function callerUid() {
  return typeof process.getuid === "function" ? process.getuid() : undefined;
}

function isUnsafeMode(stat) {
  return (stat.mode & 0o022) !== 0;
}

function requireTrustedOwnedStat(stat, label) {
  const uid = callerUid();
  if (uid !== undefined && stat.uid !== uid) blocked(`${label} is not owned by the caller`);
  if (isUnsafeMode(stat)) blocked(`${label} has unsafe write mode`);
}

async function checked(operation, signal) {
  checkpoint(signal);
  const result = await operation();
  checkpoint(signal);
  return result;
}

function inspectionSignal(parentSignal, deadlineMs) {
  const controller = new globalThis.AbortController();
  let timer;
  const abortFromParent = () => controller.abort(parentSignal.reason);
  if (parentSignal?.aborted) abortFromParent();
  else parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  if (Number.isFinite(deadlineMs) && deadlineMs > 0) {
    timer = setTimeout(
      () => controller.abort(new Error("retained archive inspection deadline exceeded")),
      deadlineMs,
    );
    timer.unref?.();
  }
  return {
    signal: controller.signal,
    cleanup() {
      if (timer) clearTimeout(timer);
      parentSignal?.removeEventListener("abort", abortFromParent);
    },
  };
}

function validateExpectedDigest(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{128}$/u.test(value))
    blocked("expected SHA512 digest is not canonical lowercase hex");
}

function validateArchivePath(rawPath, limits, seenPaths) {
  if (typeof rawPath !== "string" || rawPath.length === 0) blocked("archive entry has no path");
  const pathKey = rawPath.endsWith("/") ? rawPath.slice(0, -1) : rawPath;
  if (Buffer.byteLength(pathKey, "utf8") > limits.maxPathBytes)
    blocked(`path exceeds ${limits.maxPathBytes} bytes: ${pathKey}`);
  const normalized = path.posix.normalize(pathKey);
  if (
    normalized !== pathKey ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    normalized === ".." ||
    normalized.startsWith("/") ||
    path.win32.isAbsolute(pathKey) ||
    pathKey.includes("\\")
  )
    blocked(`unsafe archive path: ${rawPath}`);
  const parts = pathKey.split("/");
  if (parts.some((part) => part === "" || part === "." || part === ".."))
    blocked(`unsafe archive path segment: ${rawPath}`);
  if (parts.length > limits.maxDepth) blocked(`path depth exceeds ${limits.maxDepth}: ${rawPath}`);
  if (seenPaths.has(pathKey)) blocked(`duplicate archive path: ${pathKey}`);
  seenPaths.add(pathKey);
  return parts;
}

function validateEntryMetadata(entry) {
  if (entry.uid && entry.uid !== 0) blocked(`unsafe archive owner for ${entry.path}`);
  if (entry.gid && entry.gid !== 0) blocked(`unsafe archive group for ${entry.path}`);
  if ((entry.mode ?? 0) & 0o022) blocked(`unsafe archive write mode for ${entry.path}`);
}

function parentDirectories(parts) {
  const directories = [];
  for (let index = 1; index < parts.length; index += 1)
    directories.push(parts.slice(0, index).join("/"));
  return directories;
}

function countInflatedBytes(limits, state) {
  return new Transform({
    transform(chunk, _encoding, callback) {
      state.inflatedBytes += chunk.length;
      if (state.inflatedBytes > limits.maxInflatedBytes)
        callback(blockedError(`inflated archive exceeds ${limits.maxInflatedBytes} bytes`));
      else callback(null, chunk);
    },
  });
}

function collectEntry(
  entry,
  limits,
  state,
  entriesByPath,
  impliedDirectories,
  explicitDirectories,
) {
  state.entries += 1;
  if (state.entries > limits.maxEntries)
    blocked(`archive entry count exceeds ${limits.maxEntries}`);
  validateEntryMetadata(entry);
  const parts = validateArchivePath(entry.path, limits, state.seenPaths);
  for (const directory of parentDirectories(parts)) impliedDirectories.add(directory);

  if (entry.type === "Directory") {
    explicitDirectories.add(entry.path.replace(/\/$/u, ""));
    entry.resume();
    return Promise.resolve();
  }
  if (entry.type !== "File" && entry.type !== "OldFile") {
    entry.resume();
    blocked(`archive contains unsupported entry type ${entry.type} at ${entry.path}`);
  }
  if ((entry.size ?? 0) > limits.maxFileBytes)
    blocked(`file entry exceeds ${limits.maxFileBytes} bytes: ${entry.path}`);

  return new Promise((resolve, reject) => {
    const chunks = [];
    let fileBytes = 0;
    entry.on("data", (chunk) => {
      fileBytes += chunk.length;
      if (fileBytes > limits.maxFileBytes) {
        entry.destroy(
          blockedError(`file entry exceeds ${limits.maxFileBytes} bytes: ${entry.path}`),
        );
        return;
      }
      chunks.push(chunk);
    });
    entry.once("error", reject);
    entry.once("end", () => {
      entriesByPath.set(entry.path, {
        bytes: Buffer.concat(chunks),
        mode: entry.mode ?? 0,
        size: fileBytes,
      });
      state.maxFileBytes = Math.max(state.maxFileBytes, fileBytes);
      resolve();
    });
    entry.resume();
  });
}

async function readTrustedArchiveFile(archivePath, limits, signal, testHooks) {
  const before = await checked(() => lstat(archivePath), signal);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1)
    blocked("archive path is not a trusted regular file");
  requireTrustedOwnedStat(before, "archive path");
  if (before.size > limits.maxCompressedBytes)
    blocked(`compressed archive exceeds ${limits.maxCompressedBytes} bytes`);

  let handle;
  try {
    handle = await checked(
      () => open(archivePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW),
      signal,
    );
    const opened = await checked(() => handle.stat(), signal);
    if (
      !opened.isFile() ||
      opened.isSymbolicLink() ||
      opened.nlink !== 1 ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino
    )
      blocked("archive path changed before bounded read");
    requireTrustedOwnedStat(opened, "archive path");
    if (opened.size > limits.maxCompressedBytes)
      blocked(`compressed archive exceeds ${limits.maxCompressedBytes} bytes`);
    const compressedBytes = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < compressedBytes.length) {
      checkpoint(signal);
      const { bytesRead } = await handle.read(
        compressedBytes,
        offset,
        compressedBytes.length - offset,
        offset,
      );
      if (bytesRead === 0) blocked("archive file changed during bounded read");
      offset += bytesRead;
    }
    checkpoint(signal);
    const after = await handle.stat();
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size)
      blocked("archive path changed during bounded read");
    return compressedBytes;
  } finally {
    if (handle) {
      await handle.close();
      testHooks?.afterArchiveHandleClosed?.();
    }
  }
}

async function parseArchive(compressedBytes, limits, signal) {
  const state = { entries: 0, inflatedBytes: 0, maxFileBytes: 0, seenPaths: new Set() };
  const entriesByPath = new Map();
  const impliedDirectories = new Set();
  const explicitDirectories = new Set();
  const pendingEntries = [];
  let firstEntryError;
  const parser = listTar({
    gzip: false,
    strict: true,
    onentry(entry) {
      try {
        pendingEntries.push(
          collectEntry(
            entry,
            limits,
            state,
            entriesByPath,
            impliedDirectories,
            explicitDirectories,
          ),
        );
      } catch (error) {
        firstEntryError ??= error;
        entry.resume();
      }
    },
  });
  const abort = () => {
    parser.abort(signal.reason);
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    await pipeline(
      Readable.from([compressedBytes], { signal }),
      createGunzip(),
      countInflatedBytes(limits, state),
      parser,
      { signal },
    );
    if (firstEntryError) throw firstEntryError;
    await Promise.all(pendingEntries);
  } finally {
    signal.removeEventListener("abort", abort);
  }
  return { entriesByPath, impliedDirectories, explicitDirectories, state };
}

function containedPath(root, relative) {
  const target = path.resolve(root, ...relative.split("/"));
  const rootPrefix = `${root}${path.sep}`;
  if (target !== root && !target.startsWith(rootPrefix))
    blocked(`archive path escapes root: ${relative}`);
  return target;
}

function validateRetainedPath(relative, limits) {
  if (Buffer.byteLength(relative, "utf8") > limits.maxPathBytes)
    blocked(`retained path exceeds ${limits.maxPathBytes} bytes: ${relative}`);
  const depth = relative ? relative.split("/").length : 0;
  if (depth > limits.maxDepth)
    blocked(`retained path depth exceeds ${limits.maxDepth}: ${relative}`);
}

function expectedRetainedDirectories(archive) {
  return new Set([...archive.impliedDirectories, ...archive.explicitDirectories]);
}

async function collectRetainedTree(
  root,
  expectedFiles,
  expectedDirectories,
  limits,
  signal,
  testHooks,
) {
  const manifest = { files: new Map(), directories: new Set() };
  const state = { entries: 0, bytes: 0 };

  async function visitDirectory(current = "") {
    checkpoint(signal);
    const absolute = current ? containedPath(root, current) : root;
    const directory = await checked(() => opendir(absolute), signal);
    try {
      for await (const entry of directory) {
        checkpoint(signal);
        const relative = current ? path.posix.join(current, entry.name) : entry.name;
        testHooks?.beforeRetainedEntry?.(relative);
        checkpoint(signal);
        validateRetainedPath(relative, limits);
        state.entries += 1;
        if (state.entries > limits.maxRetainedEntries)
          blocked(`retained path count exceeds ${limits.maxRetainedEntries}`);
        const target = containedPath(root, relative);
        const st = await checked(() => lstat(target), signal);
        if (st.isSymbolicLink()) blocked(`retained tree contains unsupported link: ${relative}`);
        requireTrustedOwnedStat(st, `retained path ${relative}`);

        if (st.isDirectory()) {
          if (!expectedDirectories.has(relative)) blocked(`extra retained path: ${relative}`);
          manifest.directories.add(relative);
          await visitDirectory(relative);
        } else if (st.isFile()) {
          if (!expectedFiles.has(relative)) blocked(`extra retained path: ${relative}`);
          if (st.nlink !== 1) blocked(`retained tree contains hardlink alias: ${relative}`);
          if (st.size > limits.maxFileBytes)
            blocked(`retained file exceeds ${limits.maxFileBytes} bytes: ${relative}`);
          state.bytes += st.size;
          if (state.bytes > limits.maxRetainedBytes)
            blocked(`retained file bytes exceed ${limits.maxRetainedBytes}`);
          manifest.files.set(relative, {
            bytes: await checked(() => readFile(target), signal),
            mode: st.mode & 0o777,
          });
        } else {
          blocked(`retained tree contains unsupported path type: ${relative}`);
        }
      }
    } finally {
      await directory.close().catch(() => {});
      testHooks?.afterRetainedDirectoryClosed?.(current);
    }
  }

  await visitDirectory();
  return manifest;
}

async function compareRetainedTree(extractedRoot, archive, limits, signal, testHooks) {
  const suppliedRoot = path.resolve(extractedRoot);
  const suppliedRootStat = await checked(() => lstat(suppliedRoot), signal);
  if (!suppliedRootStat.isDirectory() || suppliedRootStat.isSymbolicLink())
    blocked("extracted root is not a trusted directory");
  requireTrustedOwnedStat(suppliedRootStat, "extracted root");
  const root = await checked(() => realpath(suppliedRoot), signal);
  const rootStat = await checked(() => lstat(root), signal);
  if (
    !rootStat.isDirectory() ||
    rootStat.isSymbolicLink() ||
    rootStat.dev !== suppliedRootStat.dev ||
    rootStat.ino !== suppliedRootStat.ino
  )
    blocked("extracted root changed before comparison");
  requireTrustedOwnedStat(rootStat, "extracted root");

  const expectedDirectories = expectedRetainedDirectories(archive);
  for (const directory of expectedDirectories) {
    validateRetainedPath(directory, limits);
    const st = await checked(() => lstat(containedPath(root, directory)), signal);
    if (!st.isDirectory() || st.isSymbolicLink())
      blocked(`missing retained directory: ${directory}`);
    requireTrustedOwnedStat(st, `retained directory ${directory}`);
  }
  const retained = await collectRetainedTree(
    root,
    new Set(archive.entriesByPath.keys()),
    expectedDirectories,
    limits,
    signal,
    testHooks,
  );
  for (const directory of expectedDirectories) {
    if (!retained.directories.has(directory)) blocked(`missing retained directory: ${directory}`);
  }
  for (const [relative, expected] of archive.entriesByPath) {
    const retainedFile = retained.files.get(relative);
    if (!retainedFile) blocked(`missing retained file: ${relative}`);
    if ((expected.mode & 0o777) !== retainedFile.mode) blocked(`file mode differs: ${relative}`);
    if (!expected.bytes.equals(retainedFile.bytes)) blocked(`file bytes differ: ${relative}`);
  }
}

export async function proveRetainedPnpmArchive({
  archivePath,
  extractedRoot,
  expectedSha512Hex,
  limits: limitOverrides,
  signal: parentSignal,
  testHooks,
}) {
  const limits = mergeLimits(limitOverrides);
  validateExpectedDigest(expectedSha512Hex);
  const { signal, cleanup } = inspectionSignal(parentSignal, limits.inspectionDeadlineMs);
  try {
    checkpoint(signal);
    const compressedBytes = await readTrustedArchiveFile(archivePath, limits, signal, testHooks);
    const observed = createHash("sha512").update(compressedBytes).digest("hex");
    if (observed !== expectedSha512Hex) blocked("compressed archive digest differs from the pin");
    checkpoint(signal);
    const archive = await parseArchive(compressedBytes, limits, signal);
    checkpoint(signal);
    await compareRetainedTree(extractedRoot, archive, limits, signal, testHooks);
    checkpoint(signal);
    return Object.freeze({
      compressedBytes: compressedBytes.length,
      inflatedBytes: archive.state.inflatedBytes,
      entries: archive.state.entries,
      regularFiles: archive.entriesByPath.size,
      implicitDirectories: archive.impliedDirectories.size,
      explicitDirectories: archive.explicitDirectories.size,
      maxFileBytes: archive.state.maxFileBytes,
    });
  } finally {
    cleanup();
  }
}
