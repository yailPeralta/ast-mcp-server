import { createHash, randomUUID } from "node:crypto";
import { constants, lstatSync, realpathSync } from "node:fs";
import { open, readFile, stat, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { createTwoFilesPatch } from "diff";
import { LanguageVariant, Node, ScriptTarget, SyntaxKind, ts, type Project } from "ts-morph";
import {
  compareDiagnostics,
  normalizeDiagnostic,
  type DiagnosticDelta,
  type NormalizedDiagnostic,
} from "./diagnostics.js";
import {
  probePublicationCapability,
  publishAuthenticated,
  removeOwnedPublicationEntry,
  rollbackOwnedCommit,
  snapshotHeldFile,
  type CommitToken,
  type PublicationIdentity,
  type PublicationPlan,
} from "./authenticated-publication.js";
import {
  createFreshProject,
  findDeclarationByName,
  getSourceFileOrThrow,
  invalidateProjectIfIdle,
  recordProjectMutationHistory,
  withProjectOperation,
} from "./project.js";
import { PublicOperationalError } from "./public-errors.js";
import { NO_REQUEST_CONTEXT, type RequestContext } from "./request-context.js";
import { executableDeclaration } from "./symbols.js";
import { buildClassScaffold, type ClassScaffoldSpec } from "./scaffold.js";
import { withWorkspaceFileLock, type RuntimeStateOptions } from "./runtime-state.js";
import { createWorkspaceSnapshot, hashBytes, hashWorkspaceFiles } from "./workspace.js";

const DEFAULT_OPERATION_TTL_MS = 15 * 60 * 1000;
const DEFAULT_MAX_OPERATIONS = 100;
const MAX_INLINE_PREVIEW_CHARS = 100_000;
const ABSENT_FILE_HASH = "0".repeat(64);
const DEFAULT_NEW_FILE_MODE = 0o644;

export type OperationKind = "rename_symbol" | "replace_symbol_body" | "scaffold_class";
export type OperationStatus = "prepared" | "applied";

interface PlannedFileInternal {
  absolutePath: string;
  file: string;
  originalHash: string;
  updatedHash: string;
  originalText: string;
  updatedText: string;
  originalBytes: Buffer;
  updatedBytes: Buffer;
  diff: string;
  mode: number;
}

export interface PlannedFileSummary {
  file: string;
  original_hash: string;
  updated_hash: string;
}

export interface PreparedOperation {
  operation_id: string;
  plan_hash: string;
  kind: OperationKind;
  status: OperationStatus;
  project_root: string;
  created_at: string;
  expires_at: string;
  affected_files: PlannedFileSummary[];
  reference_count: number;
  workspace_hash: string;
  post_workspace_hash: string;
  workspace_file_count: number;
  diagnostics: DiagnosticDelta;
  allow_new_errors: boolean;
  blocked: boolean;
  block_reason: string | null;
  preview: string | null;
  preview_truncated: boolean;
}

interface OperationRecord extends PreparedOperation {
  tsConfigFilePath: string;
  files: PlannedFileInternal[];
  applied_at?: string;
  receiptWriter?: () => Promise<void>;
  lockStateDirectory?: string;
}

export interface PersistedOperationFile {
  file: string;
  original_hash: string;
  updated_hash: string;
  original_bytes_base64: string;
  updated_bytes_base64: string;
  mode: number;
}

export interface PersistedOperationRecord extends PreparedOperation {
  applied_at?: string;
  files: PersistedOperationFile[];
}

export interface AppliedOperation {
  operation_id: string;
  kind: OperationKind;
  status: "applied";
  applied_at: string;
  affected_files: string[];
  idempotent_replay: boolean;
}

const operations = new Map<string, OperationRecord>();
const writeQueues = new Map<string, Promise<void>>();

type OperationFilePhase =
  "capability-preflight" | "before-publish" | "after-commit" | "before-rollback";

interface OperationTestHooks {
  afterRetain?: (operationId: string) => Promise<void> | void;
  afterWriteLockEnqueue?: () => Promise<void> | void;
  onFilePhase?: (event: {
    operationId: string;
    file: string;
    index: number;
    phase: OperationFilePhase;
  }) => Promise<void> | void;
}

let operationTestHooks: OperationTestHooks = {};
let operationTtlMs = DEFAULT_OPERATION_TTL_MS;
let maxOperations = DEFAULT_MAX_OPERATIONS;
let operationNow = (): number => Date.now();

function hash(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

function planHashFor(operation: {
  operation_id: string;
  kind: OperationKind;
  project_root: string;
  created_at: string;
  expires_at: string;
  reference_count: number;
  workspace_hash: string;
  post_workspace_hash: string;
  workspace_file_count: number;
  diagnostics: DiagnosticDelta;
  allow_new_errors: boolean;
  blocked: boolean;
  files: ReadonlyArray<{
    file: string;
    originalHash: string;
    updatedHash: string;
    mode: number;
  }>;
}): string {
  return hash(
    JSON.stringify({
      version: 1,
      operation_id: operation.operation_id,
      kind: operation.kind,
      project_root: operation.project_root,
      created_at: operation.created_at,
      expires_at: operation.expires_at,
      reference_count: operation.reference_count,
      workspace_hash: operation.workspace_hash,
      post_workspace_hash: operation.post_workspace_hash,
      workspace_file_count: operation.workspace_file_count,
      diagnostics: operation.diagnostics,
      allow_new_errors: operation.allow_new_errors,
      blocked: operation.blocked,
      files: operation.files.map((file) => ({
        file: file.file,
        original_hash: file.originalHash,
        updated_hash: file.updatedHash,
        mode: file.mode,
      })),
    }),
  );
}

function pruneOperations(): void {
  const now = operationNow();
  for (const [id, operation] of operations) {
    if (operation.status === "prepared" && Date.parse(operation.expires_at) <= now) {
      operations.delete(id);
    }
  }
  while (operations.size >= maxOperations) {
    const oldest = operations.keys().next().value as string | undefined;
    if (!oldest) break;
    operations.delete(oldest);
  }
}

function normalizeProjectDiagnostics(
  project: Project,
  projectRoot: string,
  requestContext: RequestContext,
): NormalizedDiagnostic[] {
  return [...project.getConfigFileParsingDiagnostics(), ...project.getPreEmitDiagnostics()].map(
    (diagnostic) => normalizeDiagnostic(diagnostic, projectRoot, requestContext),
  );
}

function decodeSource(bytes: Buffer, filePath: string): string {
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) {
    throw new Error(
      `Unsupported UTF-16 source encoding in ${filePath}. Convert it to UTF-8 first.`,
    );
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error(`Unsupported non-UTF-8 source encoding in ${filePath}.`, { cause: error });
  }
}

function encodeUpdatedSource(originalBytes: Buffer, updatedText: string): Buffer {
  const encoded = Buffer.from(updatedText, "utf8");
  const hasUtf8Bom =
    originalBytes[0] === 0xef && originalBytes[1] === 0xbb && originalBytes[2] === 0xbf;
  return hasUtf8Bom ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), encoded]) : encoded;
}

function assertSafeOperationFile(
  projectRoot: string,
  absolutePath: string,
  displayPath: string,
): void {
  const fileStat = lstatSync(absolutePath);
  if (fileStat.isSymbolicLink()) {
    throw new Error(`Operation target must not be a symbolic link: ${displayPath}`);
  }
  if (!fileStat.isFile()) {
    throw new Error(`Operation target is not a regular file: ${displayPath}`);
  }
  const canonicalPath = realpathSync(absolutePath);
  const samePath =
    process.platform === "win32"
      ? canonicalPath.toLowerCase() === absolutePath.toLowerCase()
      : canonicalPath === absolutePath;
  if (!samePath) {
    throw new Error(`Operation target traverses a symbolic link: ${displayPath}`);
  }
  if (process.platform !== "win32" && fileStat.nlink !== 1) {
    throw new Error(`Operation target must have exactly one hard link: ${displayPath}`);
  }
  const uid = process.getuid?.();
  if (uid !== undefined && fileStat.uid !== uid) {
    throw new Error(`Operation target is not owned by the current user: ${displayPath}`);
  }
  const relative = path.relative(projectRoot, canonicalPath);
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`)) {
    throw new Error(`Operation target escapes the project root: ${displayPath}`);
  }
}

function isCreatedFile(file: PlannedFileInternal): boolean {
  return file.originalHash === ABSENT_FILE_HASH;
}

function assertSafeNewOperationFile(
  projectRoot: string,
  absolutePath: string,
  displayPath: string,
): void {
  const relative = path.relative(projectRoot, absolutePath);
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`)) {
    throw new Error(`Operation target escapes the project root: ${displayPath}`);
  }
  try {
    lstatSync(absolutePath);
    throw new Error(`Operation target already exists: ${displayPath}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const parentPath = path.dirname(absolutePath);
  const parentStat = lstatSync(parentPath);
  if (parentStat.isSymbolicLink()) {
    throw new Error(`Operation target parent must not be a symbolic link: ${displayPath}`);
  }
  if (!parentStat.isDirectory()) {
    throw new Error(`Operation target parent must be a real directory: ${displayPath}`);
  }
  const canonicalParent = realpathSync(parentPath);
  const sameParent =
    process.platform === "win32"
      ? canonicalParent.toLowerCase() === parentPath.toLowerCase()
      : canonicalParent === parentPath;
  if (!sameParent) {
    throw new Error(`Operation target parent traverses a symbolic link: ${displayPath}`);
  }
  const uid = process.getuid?.();
  if (uid !== undefined && parentStat.uid !== uid) {
    throw new Error(`Operation target parent is not owned by the current user: ${displayPath}`);
  }
}

function assertSafeCreationState(
  projectRoot: string,
  absolutePath: string,
  displayPath: string,
): void {
  try {
    lstatSync(absolutePath);
    assertSafeOperationFile(projectRoot, absolutePath, displayPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    assertSafeNewOperationFile(projectRoot, absolutePath, displayPath);
  }
}

async function createPlan(
  projectRootInput: string,
  kind: OperationKind,
  allowNewErrors: boolean,
  mutate: (project: Project, projectRoot: string) => number,
  requestContext: RequestContext,
): Promise<PreparedOperation> {
  requestContext.checkpoint();
  let retainedOperationId: string | undefined;
  return withProjectOperation(
    projectRootInput,
    async (operationContext) => {
      operationContext.checkpoint();
      pruneOperations();
      const context = createFreshProject(projectRootInput);
      const workspaceBefore = createWorkspaceSnapshot(context);
      operationContext.checkpoint();
      const beforeDiagnostics = normalizeProjectDiagnostics(
        context.project,
        context.projectRoot,
        operationContext,
      );
      const originals = new Map(
        context.project
          .getSourceFiles()
          .map((sourceFile) => [sourceFile.getFilePath(), sourceFile.getFullText()]),
      );

      for (const [filePath, sourceText] of originals) {
        operationContext.checkpoint();
        assertSafeOperationFile(
          context.projectRoot,
          filePath,
          path.relative(context.projectRoot, filePath),
        );
        const diskText = decodeSource(await readFile(filePath), filePath);
        operationContext.checkpoint();
        if (diskText !== sourceText) {
          throw new Error(
            `Workspace changed while the operation was being prepared (${path.relative(context.projectRoot, filePath)}). Retry preparation.`,
          );
        }
      }

      operationContext.checkpoint();
      const referenceCount = mutate(context.project, context.projectRoot);
      operationContext.checkpoint();
      const afterDiagnostics = normalizeProjectDiagnostics(
        context.project,
        context.projectRoot,
        operationContext,
      );
      const diagnosticDelta = compareDiagnostics(
        beforeDiagnostics,
        afterDiagnostics,
        operationContext,
      );
      const files: PlannedFileInternal[] = [];

      for (const sourceFile of context.project.getSourceFiles()) {
        operationContext.checkpoint();
        const absolutePath = sourceFile.getFilePath();
        const originalText = originals.get(absolutePath);
        const updatedText = sourceFile.getFullText();

        if (originalText === undefined) {
          const file = path.relative(context.projectRoot, absolutePath);
          assertSafeNewOperationFile(context.projectRoot, absolutePath, file);
          const originalBytes = Buffer.alloc(0);
          const updatedBytes = Buffer.from(updatedText, "utf8");
          files.push({
            absolutePath,
            file,
            originalHash: ABSENT_FILE_HASH,
            updatedHash: hashBytes(updatedBytes),
            originalText: "",
            updatedText,
            originalBytes,
            updatedBytes,
            diff: createTwoFilesPatch("/dev/null", file, "", updatedText, "before", "after", {
              context: 3,
            }),
            mode: DEFAULT_NEW_FILE_MODE,
          });
          continue;
        }
        if (updatedText === originalText) continue;
        const originalBytes = await readFile(absolutePath);
        operationContext.checkpoint();
        if (decodeSource(originalBytes, absolutePath) !== originalText) {
          throw new Error(
            `Workspace changed while the operation was being prepared (${path.relative(context.projectRoot, absolutePath)}). Retry preparation.`,
          );
        }
        const updatedBytes = encodeUpdatedSource(originalBytes, updatedText);
        const fileStat = await stat(absolutePath);
        operationContext.checkpoint();
        const file = path.relative(context.projectRoot, absolutePath);
        files.push({
          absolutePath,
          file,
          originalHash: hashBytes(originalBytes),
          updatedHash: hashBytes(updatedBytes),
          originalText,
          updatedText,
          originalBytes,
          updatedBytes,
          diff: createTwoFilesPatch(file, file, originalText, updatedText, "before", "after", {
            context: 3,
          }),
          mode: fileStat.mode,
        });
      }

      files.sort((left, right) => left.file.localeCompare(right.file));
      if (files.length === 0) {
        throw new Error("The structural operation produced no file changes.");
      }

      const postWorkspaceFiles = new Map(workspaceBefore.files);
      for (const file of files) {
        operationContext.checkpoint();
        if (!isCreatedFile(file) && !postWorkspaceFiles.has(file.absolutePath)) {
          throw new Error(`Affected file is missing from the workspace snapshot: ${file.file}`);
        }
        postWorkspaceFiles.set(file.absolutePath, file.updatedHash);
      }
      const postWorkspaceHash = hashWorkspaceFiles(postWorkspaceFiles);

      const workspaceAfter = createWorkspaceSnapshot(createFreshProject(context.tsConfigFilePath));
      operationContext.checkpoint();
      if (workspaceAfter.digest !== workspaceBefore.digest) {
        throw new Error(
          "Workspace changed while the operation was being prepared. Retry preparation.",
        );
      }

      const fullPreview = files.map((file) => file.diff).join("\n");
      const blocked = !allowNewErrors && diagnosticDelta.addedErrors.length > 0;
      const now = operationNow();
      const operationId = randomUUID();
      const recordWithoutHash = {
        operation_id: operationId,
        kind,
        status: "prepared",
        project_root: context.projectRoot,
        tsConfigFilePath: context.tsConfigFilePath,
        created_at: new Date(now).toISOString(),
        expires_at: new Date(now + operationTtlMs).toISOString(),
        affected_files: files.map((file) => ({
          file: file.file,
          original_hash: file.originalHash,
          updated_hash: file.updatedHash,
        })),
        reference_count: referenceCount,
        workspace_hash: workspaceBefore.digest,
        post_workspace_hash: postWorkspaceHash,
        workspace_file_count: workspaceBefore.fileCount,
        diagnostics: diagnosticDelta,
        allow_new_errors: allowNewErrors,
        blocked,
        block_reason: blocked
          ? `${diagnosticDelta.addedErrors.length} new TypeScript error(s) would be introduced. Prepare again with allow_new_errors=true only after explicit review.`
          : null,
        preview: fullPreview.length <= MAX_INLINE_PREVIEW_CHARS ? fullPreview : null,
        preview_truncated: fullPreview.length > MAX_INLINE_PREVIEW_CHARS,
        files,
      } satisfies Omit<OperationRecord, "plan_hash">;
      const record: OperationRecord = {
        ...recordWithoutHash,
        plan_hash: planHashFor(recordWithoutHash),
      };
      operationContext.checkpoint();
      operations.set(operationId, record);
      recordProjectMutationHistory();
      retainedOperationId = operationId;
      await operationTestHooks.afterRetain?.(operationId);
      return publicOperation(record);
    },
    requestContext,
  ).catch((error: unknown) => {
    if (retainedOperationId) operations.delete(retainedOperationId);
    throw error;
  });
}

function publicOperation(record: OperationRecord): PreparedOperation {
  return {
    operation_id: record.operation_id,
    plan_hash: record.plan_hash,
    kind: record.kind,
    status: record.status,
    project_root: record.project_root,
    created_at: record.created_at,
    expires_at: record.expires_at,
    affected_files: record.affected_files,
    reference_count: record.reference_count,
    workspace_hash: record.workspace_hash,
    post_workspace_hash: record.post_workspace_hash,
    workspace_file_count: record.workspace_file_count,
    diagnostics: record.diagnostics,
    allow_new_errors: record.allow_new_errors,
    blocked: record.blocked,
    block_reason: record.block_reason,
    preview: record.preview,
    preview_truncated: record.preview_truncated,
  };
}

export async function prepareRename(
  args: {
    projectRoot: string;
    filePath: string;
    symbolPath: string;
    newName: string;
    allowNewErrors?: boolean;
  },
  requestContext: RequestContext = NO_REQUEST_CONTEXT,
): Promise<PreparedOperation> {
  requestContext.checkpoint();
  const scanner = ts.createScanner(
    ScriptTarget.Latest,
    false,
    LanguageVariant.Standard,
    args.newName,
  );
  const validIdentifier =
    scanner.scan() === SyntaxKind.Identifier && scanner.scan() === SyntaxKind.EndOfFileToken;
  if (!validIdentifier) {
    throw new Error(`"${args.newName}" is not a valid TypeScript identifier.`);
  }

  return createPlan(
    args.projectRoot,
    "rename_symbol",
    args.allowNewErrors ?? false,
    (project) => {
      const sourceFile = getSourceFileOrThrow(project, args.filePath);
      const node = findDeclarationByName(sourceFile, args.symbolPath);
      if (!Node.isRenameable(node)) {
        throw new Error(
          `Symbol "${args.symbolPath}" (${node.getKindName()}) does not support structural rename.`,
        );
      }
      const referenceCount = Node.isReferenceFindable(node)
        ? node.findReferencesAsNodes().length
        : 0;
      node.rename(args.newName);
      return referenceCount;
    },
    requestContext,
  );
}

export async function prepareReplaceBody(
  args: {
    projectRoot: string;
    filePath: string;
    symbolPath: string;
    newBody: string;
    allowNewErrors?: boolean;
  },
  requestContext: RequestContext = NO_REQUEST_CONTEXT,
): Promise<PreparedOperation> {
  return createPlan(
    args.projectRoot,
    "replace_symbol_body",
    args.allowNewErrors ?? false,
    (project) => {
      const sourceFile = getSourceFileOrThrow(project, args.filePath);
      const declaration = findDeclarationByName(sourceFile, args.symbolPath);
      const executable = executableDeclaration(declaration) as Node & {
        setBodyText(text: string): Node;
      };
      if (typeof executable.setBodyText !== "function") {
        throw new Error(`Symbol "${args.symbolPath}" does not expose a replaceable body.`);
      }
      if (Node.isArrowFunction(executable) && !Node.isBlock(executable.getBody())) {
        executable.getBody().replaceWithText("{}");
      }
      executable.setBodyText(args.newBody);
      return 0;
    },
    requestContext,
  );
}

export interface PreparedClassScaffold {
  operation: PreparedOperation;
  file: string;
  className: string;
  outline: string;
  pendingMethods: string[];
}

export async function prepareScaffoldClass(
  args: {
    projectRoot: string;
    filePath: string;
    spec: ClassScaffoldSpec;
    allowNewErrors?: boolean;
  },
  requestContext: RequestContext = NO_REQUEST_CONTEXT,
): Promise<PreparedClassScaffold> {
  requestContext.checkpoint();
  if (path.isAbsolute(args.filePath)) {
    throw new Error("Scaffold file_path must be project-relative.");
  }
  const normalizedFile = path.normalize(args.filePath);
  if (
    normalizedFile === "." ||
    normalizedFile === ".." ||
    normalizedFile.startsWith(`..${path.sep}`) ||
    normalizedFile !== args.filePath.split(path.posix.sep).join(path.sep)
  ) {
    throw new Error("Scaffold file_path must be normalized and remain inside the project root.");
  }
  if (!/\.(?:ts|tsx)$/.test(normalizedFile) || normalizedFile.endsWith(".d.ts")) {
    throw new Error("Scaffold file_path must target a .ts or .tsx implementation file.");
  }

  let metadata: { outline: string; pendingMethods: string[] } | undefined;
  const operation = await createPlan(
    args.projectRoot,
    "scaffold_class",
    args.allowNewErrors ?? false,
    (project, projectRoot) => {
      const absolutePath = path.resolve(projectRoot, normalizedFile);
      assertSafeNewOperationFile(projectRoot, absolutePath, normalizedFile);
      const scaffold = buildClassScaffold(project, absolutePath, args.spec);
      metadata = {
        outline: scaffold.outline,
        pendingMethods: scaffold.pendingMethods,
      };
      return 0;
    },
    requestContext,
  );
  if (!metadata) throw new Error("Scaffold generation did not produce metadata.");
  return {
    operation,
    file: normalizedFile.split(path.sep).join(path.posix.sep),
    className: args.spec.className,
    outline: metadata.outline,
    pendingMethods: metadata.pendingMethods,
  };
}

async function withWriteLock<T>(
  key: string,
  requestContext: RequestContext,
  callback: () => Promise<T>,
): Promise<T> {
  requestContext.checkpoint();
  const previous = writeQueues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  writeQueues.set(key, next);
  try {
    await operationTestHooks.afterWriteLockEnqueue?.();
    await previous;
    requestContext.checkpoint();
    return await callback();
  } finally {
    release();
    if (writeQueues.get(key) === next) writeQueues.delete(key);
  }
}

interface HeldPublication {
  readonly plan: PublicationPlan;
  readonly handles: FileHandle[];
  readonly parentPath: string;
  readonly parentDev: bigint;
  readonly parentIno: bigint;
  committed?: CommitToken;
  cleanupIdentity: PublicationIdentity | null;
}

function matchesPrepared(identity: PublicationIdentity, sha256: string, mode: number): boolean {
  return identity.sha256 === sha256 && identity.mode === (mode & 0o777);
}

async function stageFile(file: PlannedFileInternal, operationId: string): Promise<HeldPublication> {
  const parentPath = path.dirname(file.absolutePath);
  const destinationBasename = path.basename(file.absolutePath);
  const stageBasename = `${destinationBasename}.ast-mcp-${operationId}-${randomUUID()}.tmp`;
  const temporaryPath = path.join(parentPath, stageBasename);
  const handles: FileHandle[] = [];
  let directory: FileHandle | undefined;
  let stage: FileHandle | undefined;
  try {
    directory = await open(
      parentPath,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    handles.push(directory);
    const heldParent = await directory.stat({ bigint: true });
    const namedParent = lstatSync(parentPath, { bigint: true });
    if (
      !heldParent.isDirectory() ||
      !namedParent.isDirectory() ||
      heldParent.dev !== namedParent.dev ||
      heldParent.ino !== namedParent.ino
    ) {
      throw new Error("Publication parent identity changed during staging.");
    }
    stage = await open(temporaryPath, "wx", file.mode);
    handles.push(stage);
    await stage.writeFile(file.updatedBytes);
    await stage.chmod(file.mode & 0o777);
    await stage.sync();
    const stageIdentity = await snapshotHeldFile(stage);
    if (!matchesPrepared(stageIdentity, file.updatedHash, file.mode)) {
      throw new Error("Staged publication does not match the reviewed postimage.");
    }
    const plan: PublicationPlan = {
      kind: isCreatedFile(file) ? "creation" : "replacement",
      directory,
      destinationBasename,
      stage,
      stageBasename,
      stageIdentity,
    };
    if (!isCreatedFile(file)) {
      const preimage = await open(
        `/proc/self/fd/${directory.fd}/${destinationBasename}`,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      handles.push(preimage);
      const preimageIdentity = await snapshotHeldFile(preimage);
      if (!matchesPrepared(preimageIdentity, file.originalHash, file.mode)) {
        throw new Error(`Conflict: ${file.file} changed while publication was staged.`);
      }
      plan.preimage = preimage;
      plan.preimageIdentity = preimageIdentity;
    }
    return {
      plan,
      handles,
      parentPath,
      parentDev: heldParent.dev,
      parentIno: heldParent.ino,
      cleanupIdentity: plan.stageIdentity,
    };
  } catch (error) {
    if (directory && stage) {
      try {
        const currentStage = await snapshotHeldFile(stage);
        await removeOwnedPublicationEntry(directory, stageBasename, currentStage);
      } catch {
        // Preserve the original staging error; cleanup remains best effort.
      }
    }
    await Promise.allSettled(handles.map((handle) => handle.close()));
    throw error;
  }
}

async function authenticateHeldParent(held: HeldPublication): Promise<void> {
  const current = lstatSync(held.parentPath, { bigint: true });
  const opened = await held.plan.directory.stat({ bigint: true });
  if (
    !current.isDirectory() ||
    current.isSymbolicLink() ||
    current.dev !== held.parentDev ||
    current.ino !== held.parentIno ||
    opened.dev !== held.parentDev ||
    opened.ino !== held.parentIno
  ) {
    throw new Error("Conflict: publication parent identity changed before publication.");
  }
}

async function closeHeldPublication(held: HeldPublication): Promise<void> {
  await Promise.allSettled(held.handles.map((handle) => handle.close()));
}

async function cleanupHeldPublication(held: HeldPublication): Promise<void> {
  if (held.cleanupIdentity !== null) {
    await removeOwnedPublicationEntry(
      held.plan.directory,
      held.plan.stageBasename,
      held.cleanupIdentity,
    ).catch(() => false);
  }
  await closeHeldPublication(held);
}

async function preserveHeldPublications(held: Iterable<HeldPublication>): Promise<void> {
  const publications = [...held];
  for (const publication of publications) publication.cleanupIdentity = null;
  await Promise.all(publications.map(closeHeldPublication));
}

async function syncDirectories(files: readonly PlannedFileInternal[]): Promise<void> {
  const directories = new Set(files.map((file) => path.dirname(file.absolutePath)));
  for (const directory of directories) {
    const handle = await open(directory, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
}

async function currentWorkspaceHash(
  operation: OperationRecord,
  requestContext: RequestContext,
): Promise<string> {
  requestContext.checkpoint();
  const context = createFreshProject(operation.tsConfigFilePath);
  const snapshot = createWorkspaceSnapshot(context);
  const files = new Map(snapshot.files);
  for (const file of operation.files) {
    requestContext.checkpoint();
    if (!isCreatedFile(file)) continue;
    try {
      files.set(file.absolutePath, hashBytes(await readFile(file.absolutePath)));
      requestContext.checkpoint();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      files.delete(file.absolutePath);
    }
  }
  requestContext.checkpoint();
  return hashWorkspaceFiles(files);
}

function appliedResult(operation: OperationRecord, idempotentReplay: boolean): AppliedOperation {
  return {
    operation_id: operation.operation_id,
    kind: operation.kind,
    status: "applied",
    applied_at: operation.applied_at!,
    affected_files: operation.files.map((file) => file.file),
    idempotent_replay: idempotentReplay,
  };
}

export function configureOperationApply(
  operationId: string,
  options: RuntimeStateOptions & { receiptWriter: () => Promise<void> },
): void {
  const operation = operations.get(operationId);
  if (!operation) {
    throw new Error(`Prepared operation "${operationId}" was not found or has expired.`);
  }
  operation.receiptWriter = options.receiptWriter;
  operation.lockStateDirectory = options.stateDirectory;
}

export async function applyOperation(
  operationId: string,
  planHash: string,
  requestContext: RequestContext = NO_REQUEST_CONTEXT,
): Promise<AppliedOperation> {
  requestContext.checkpoint();
  const operation = operations.get(operationId);
  if (!operation) {
    throw new Error(`Prepared operation "${operationId}" was not found or has expired.`);
  }
  if (planHash !== operation.plan_hash) {
    throw new Error(`Plan hash mismatch for operation "${operationId}". No files were written.`);
  }
  requestContext.checkpoint();
  let invalidateAfterCompletion = false;

  const persistReceipt = async (): Promise<void> => {
    if (!operation.receiptWriter) return;
    try {
      await operation.receiptWriter();
    } catch (error) {
      throw new Error(
        "Operation sources are at the verified postimages, but receipt persistence failed. Retry apply with the same reviewed plan after resolving the storage error.",
        { cause: error },
      );
    }
  };

  try {
    return await withProjectOperation(
      operation.tsConfigFilePath,
      async (operationContext) => {
        operationContext.checkpoint();
        return withWriteLock(operation.tsConfigFilePath, operationContext, async () => {
          operationContext.checkpoint();
          return withWorkspaceFileLock(
            operation.tsConfigFilePath,
            { stateDirectory: operation.lockStateDirectory },
            async () => {
              operationContext.checkpoint();
              if (operation.status === "applied") {
                for (const file of operation.files) {
                  operationContext.checkpoint();
                  assertSafeOperationFile(operation.project_root, file.absolutePath, file.file);
                  const currentBytes = await readFile(file.absolutePath);
                  operationContext.checkpoint();
                  if (hashBytes(currentBytes) !== file.updatedHash) {
                    throw new Error(
                      `Applied receipt conflict: ${file.file} no longer matches the recorded postimage.`,
                    );
                  }
                }
                operationContext.enterCompletionCritical();
                invalidateAfterCompletion = true;
                await persistReceipt();
                return appliedResult(operation, true);
              }
              if (Date.parse(operation.expires_at) <= operationNow()) {
                operations.delete(operationId);
                throw new Error(`Prepared operation "${operationId}" has expired.`);
              }
              if (operation.blocked) {
                throw new Error(
                  operation.block_reason ?? "The operation is blocked by validation errors.",
                );
              }

              for (const file of operation.files) {
                operationContext.checkpoint();
                if (isCreatedFile(file)) {
                  assertSafeCreationState(operation.project_root, file.absolutePath, file.file);
                } else {
                  assertSafeOperationFile(operation.project_root, file.absolutePath, file.file);
                }
              }

              const workspaceHash = await currentWorkspaceHash(operation, operationContext);
              if (workspaceHash === operation.post_workspace_hash) {
                for (const file of operation.files) {
                  operationContext.checkpoint();
                  assertSafeOperationFile(operation.project_root, file.absolutePath, file.file);
                  const currentBytes = await readFile(file.absolutePath);
                  operationContext.checkpoint();
                  if (hashBytes(currentBytes) !== file.updatedHash) {
                    throw new Error(
                      `Postimage recovery conflict: ${file.file} does not match the reviewed postimage.`,
                    );
                  }
                }
                operationContext.enterCompletionCritical();
                invalidateAfterCompletion = true;
                operation.status = "applied";
                operation.applied_at ??= new Date().toISOString();
                await persistReceipt();
                return appliedResult(operation, true);
              }
              if (workspaceHash !== operation.workspace_hash) {
                throw new Error(
                  "Conflict: the project source/config workspace changed after preparation. No files were written.",
                );
              }

              for (const file of operation.files) {
                operationContext.checkpoint();
                if (isCreatedFile(file)) continue;
                const currentBytes = await readFile(file.absolutePath);
                operationContext.checkpoint();
                if (hashBytes(currentBytes) !== file.originalHash) {
                  throw new Error(
                    `Conflict: ${file.file} changed after the operation was prepared. No files were written.`,
                  );
                }
              }

              const staged = new Map<PlannedFileInternal, HeldPublication>();
              const applied: PlannedFileInternal[] = [];
              let completionCritical = false;
              try {
                for (const file of operation.files) {
                  staged.set(file, await stageFile(file, operationId));
                  operationContext.checkpoint();
                }
                const probedParents = new Set<string>();
                for (const [index, file] of operation.files.entries()) {
                  operationContext.checkpoint();
                  try {
                    await operationTestHooks.onFilePhase?.({
                      operationId,
                      file: file.file,
                      index,
                      phase: "capability-preflight",
                    });
                    const parent = path.dirname(file.absolutePath);
                    if (!probedParents.has(parent)) {
                      await probePublicationCapability(parent);
                      probedParents.add(parent);
                    }
                  } catch (cause) {
                    throw new PublicOperationalError(
                      "MUTATION_BLOCKED",
                      "Authenticated publication capability is unavailable.",
                      { cause },
                    );
                  }
                  if (isCreatedFile(file)) {
                    assertSafeNewOperationFile(
                      operation.project_root,
                      file.absolutePath,
                      file.file,
                    );
                    continue;
                  }
                  const currentBytes = await readFile(file.absolutePath);
                  operationContext.checkpoint();
                  if (hashBytes(currentBytes) !== file.originalHash) {
                    throw new Error(
                      `Conflict: ${file.file} changed while the operation was being staged. No files were written.`,
                    );
                  }
                }
                for (const [index, file] of operation.files.entries()) {
                  operationContext.checkpoint();
                  await operationTestHooks.onFilePhase?.({
                    operationId,
                    file: file.file,
                    index,
                    phase: "before-publish",
                  });
                  const held = staged.get(file)!;
                  await authenticateHeldParent(held);
                  if (!completionCritical) {
                    operationContext.enterCompletionCritical();
                    completionCritical = true;
                    invalidateAfterCompletion = true;
                  }
                  const publication = await publishAuthenticated(held.plan);
                  if (publication.state === "pre_effect") {
                    if (publication.reason === "unsupported") {
                      throw new PublicOperationalError(
                        "MUTATION_BLOCKED",
                        "Authenticated publication capability is unavailable.",
                      );
                    }
                    throw new PublicOperationalError(
                      "CONFLICT",
                      "Authenticated publication preserved a competing entry.",
                    );
                  }
                  if (publication.state === "rolled_back") {
                    held.cleanupIdentity = held.plan.stageIdentity;
                    throw new PublicOperationalError(
                      "CONFLICT",
                      "Authenticated publication preserved a competing entry.",
                    );
                  }
                  if (publication.state === "ambiguous") {
                    held.cleanupIdentity = null;
                    throw new PublicOperationalError(
                      "AMBIGUOUS_APPLY",
                      "Authenticated publication ownership is ambiguous.",
                    );
                  }
                  held.committed = publication.token;
                  held.cleanupIdentity =
                    publication.token.kind === "replacement"
                      ? publication.token.displacedIdentity
                      : held.plan.stageIdentity;
                  applied.push(file);
                  await operationTestHooks.onFilePhase?.({
                    operationId,
                    file: file.file,
                    index,
                    phase: "after-commit",
                  });
                  const writtenBytes = await readFile(file.absolutePath);
                  if (hashBytes(writtenBytes) !== file.updatedHash) {
                    throw new Error(`Post-write verification failed for ${file.file}.`);
                  }
                }
                await syncDirectories(operation.files);
                await Promise.all([...staged.values()].map(cleanupHeldPublication));
                staged.clear();
              } catch (error) {
                if (PublicOperationalError.is(error) && error.code === "AMBIGUOUS_APPLY") {
                  await preserveHeldPublications(staged.values());
                  staged.clear();
                  throw error;
                }

                let rollbackAmbiguous = false;
                for (const file of [...applied].reverse()) {
                  const held = staged.get(file)!;
                  try {
                    await operationTestHooks.onFilePhase?.({
                      operationId,
                      file: file.file,
                      index: operation.files.indexOf(file),
                      phase: "before-rollback",
                    });
                    const rollback = await rollbackOwnedCommit(held.committed!);
                    if (rollback.state !== "rolled_back") {
                      held.cleanupIdentity = null;
                      rollbackAmbiguous = true;
                      break;
                    }
                    held.cleanupIdentity = held.committed!.destinationIdentity;
                  } catch {
                    held.cleanupIdentity = null;
                    rollbackAmbiguous = true;
                    break;
                  }
                }

                if (rollbackAmbiguous) {
                  await preserveHeldPublications(staged.values());
                  staged.clear();
                  throw new PublicOperationalError(
                    "AMBIGUOUS_APPLY",
                    "Authenticated rollback ownership is ambiguous.",
                    { cause: error },
                  );
                }

                await Promise.all([...staged.values()].map(cleanupHeldPublication));
                staged.clear();
                if (applied.length > 0) {
                  await syncDirectories(applied);
                  if (PublicOperationalError.is(error)) throw error;
                  throw new Error(
                    `Operation failed after replacing ${applied.length} file(s); rollback succeeded and original bytes were restored. Original error: ${
                      error instanceof Error ? error.message : String(error)
                    }`,
                    { cause: error },
                  );
                }
                throw error;
              }

              operation.status = "applied";
              operation.applied_at = new Date().toISOString();
              await persistReceipt();
              return appliedResult(operation, false);
            },
          );
        });
      },
      requestContext,
    );
  } finally {
    if (invalidateAfterCompletion) {
      invalidateProjectIfIdle(operation.tsConfigFilePath, {
        preserveCancellationTelemetry: true,
      });
    }
  }
}

export async function getOperationPreview(
  operationId: string,
  file?: string,
  requestContext: RequestContext = NO_REQUEST_CONTEXT,
): Promise<{
  operation_id: string;
  plan_hash: string;
  files: Array<{ file: string; diff: string }>;
}> {
  requestContext.checkpoint();
  const operation = operations.get(operationId);
  if (!operation) {
    throw new Error(`Prepared operation "${operationId}" was not found or has expired.`);
  }
  const tsConfigFilePath = operation.tsConfigFilePath;
  return withProjectOperation(
    tsConfigFilePath,
    (operationContext) => {
      operationContext.checkpoint();
      const retainedOperation = operations.get(operationId);
      if (!retainedOperation) {
        throw new Error(`Prepared operation "${operationId}" was not found or has expired.`);
      }
      const files = file
        ? retainedOperation.files.filter((item) => item.file === file)
        : retainedOperation.files;
      if (file && files.length === 0) {
        throw new Error(`File "${file}" is not part of operation "${operationId}".`);
      }
      operationContext.checkpoint();
      return {
        operation_id: operationId,
        plan_hash: retainedOperation.plan_hash,
        files: files.map((item) => {
          operationContext.checkpoint();
          return { file: item.file, diff: item.diff };
        }),
      };
    },
    requestContext,
  );
}

function decodePersistedBytes(value: string, label: string): Buffer {
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) {
    throw new Error(`Persisted operation contains invalid base64 for ${label}.`);
  }
  return bytes;
}

function containedOperationPath(projectRoot: string, file: string): string {
  if (path.isAbsolute(file)) {
    throw new Error(`Persisted operation file path must be project-relative: ${file}`);
  }
  const absolutePath = path.resolve(projectRoot, file);
  const relative = path.relative(projectRoot, absolutePath);
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`)) {
    throw new Error(`Persisted operation file escapes the project root: ${file}`);
  }
  if (relative !== file.split(path.posix.sep).join(path.sep)) {
    throw new Error(`Persisted operation file path is not normalized: ${file}`);
  }
  return absolutePath;
}

export function exportOperationRecord(operationId: string): PersistedOperationRecord {
  const operation = operations.get(operationId);
  if (!operation) {
    throw new Error(`Prepared operation "${operationId}" was not found or has expired.`);
  }
  return {
    ...publicOperation(operation),
    ...(operation.applied_at ? { applied_at: operation.applied_at } : {}),
    files: operation.files.map((file) => ({
      file: file.file,
      original_hash: file.originalHash,
      updated_hash: file.updatedHash,
      original_bytes_base64: file.originalBytes.toString("base64"),
      updated_bytes_base64: file.updatedBytes.toString("base64"),
      mode: file.mode,
    })),
  };
}

export function importOperationRecord(
  persisted: PersistedOperationRecord,
  expectedPlanHash: string,
): PreparedOperation {
  if (persisted.plan_hash !== expectedPlanHash) {
    throw new Error(
      `Plan hash mismatch for operation "${persisted.operation_id}". No files were written.`,
    );
  }
  if (persisted.status === "prepared" && Date.parse(persisted.expires_at) <= operationNow()) {
    throw new Error(`Prepared operation "${persisted.operation_id}" has expired.`);
  }
  if (persisted.status === "applied" && !persisted.applied_at) {
    throw new Error("Persisted applied operation is missing applied_at.");
  }
  if (persisted.status === "prepared" && persisted.applied_at) {
    throw new Error("Persisted prepared operation cannot contain applied_at.");
  }

  const context = createFreshProject(persisted.project_root);
  if (context.projectRoot !== persisted.project_root) {
    throw new Error("Persisted project_root is not canonical.");
  }
  const files: PlannedFileInternal[] = persisted.files.map((file) => {
    const absolutePath = containedOperationPath(context.projectRoot, file.file);
    const originalBytes = decodePersistedBytes(
      file.original_bytes_base64,
      `${file.file} original bytes`,
    );
    const updatedBytes = decodePersistedBytes(
      file.updated_bytes_base64,
      `${file.file} updated bytes`,
    );
    const createsFile = file.original_hash === ABSENT_FILE_HASH;
    if (
      createsFile ? originalBytes.length !== 0 : hashBytes(originalBytes) !== file.original_hash
    ) {
      throw new Error(`Persisted original hash mismatch for ${file.file}.`);
    }
    if (hashBytes(updatedBytes) !== file.updated_hash) {
      throw new Error(`Persisted updated hash mismatch for ${file.file}.`);
    }
    if (createsFile) {
      assertSafeCreationState(context.projectRoot, absolutePath, file.file);
    } else {
      assertSafeOperationFile(context.projectRoot, absolutePath, file.file);
    }
    const originalText = decodeSource(originalBytes, absolutePath);
    const updatedText = decodeSource(updatedBytes, absolutePath);
    return {
      absolutePath,
      file: file.file,
      originalHash: file.original_hash,
      updatedHash: file.updated_hash,
      originalText,
      updatedText,
      originalBytes,
      updatedBytes,
      diff: createTwoFilesPatch(
        createsFile ? "/dev/null" : file.file,
        file.file,
        originalText,
        updatedText,
        "before",
        "after",
        { context: 3 },
      ),
      mode: file.mode,
    };
  });
  files.sort((left, right) => left.file.localeCompare(right.file));
  if (files.length === 0 || new Set(files.map((file) => file.file)).size !== files.length) {
    throw new Error("Persisted operation must contain unique affected files.");
  }

  const affectedFiles = files.map((file) => ({
    file: file.file,
    original_hash: file.originalHash,
    updated_hash: file.updatedHash,
  }));
  if (JSON.stringify(affectedFiles) !== JSON.stringify(persisted.affected_files)) {
    throw new Error("Persisted affected_files do not match the exact file payloads.");
  }
  const addedErrors = persisted.diagnostics.added.filter(
    (diagnostic) => diagnostic.category === "Error",
  );
  if (JSON.stringify(addedErrors) !== JSON.stringify(persisted.diagnostics.addedErrors)) {
    throw new Error("Persisted diagnostic error delta is inconsistent.");
  }
  const blocked = !persisted.allow_new_errors && addedErrors.length > 0;
  if (persisted.blocked !== blocked) {
    throw new Error("Persisted blocked status is inconsistent with diagnostics policy.");
  }

  const fullPreview = files.map((file) => file.diff).join("\n");
  const record: OperationRecord = {
    ...persisted,
    affected_files: affectedFiles,
    blocked,
    block_reason: blocked
      ? `${addedErrors.length} new TypeScript error(s) would be introduced. Prepare again with allow_new_errors=true only after explicit review.`
      : null,
    preview: fullPreview.length <= MAX_INLINE_PREVIEW_CHARS ? fullPreview : null,
    preview_truncated: fullPreview.length > MAX_INLINE_PREVIEW_CHARS,
    tsConfigFilePath: context.tsConfigFilePath,
    files,
  };
  if (planHashFor(record) !== expectedPlanHash) {
    throw new Error(
      `Persisted plan integrity mismatch for operation "${persisted.operation_id}". No files were written.`,
    );
  }

  const existing = operations.get(record.operation_id);
  if (existing && existing.plan_hash !== record.plan_hash) {
    throw new Error(`Operation id collision for "${record.operation_id}".`);
  }
  pruneOperations();
  operations.set(record.operation_id, record);
  recordProjectMutationHistory();
  return publicOperation(record);
}

export function setOperationTestHooksForTests(hooks: OperationTestHooks): void {
  operationTestHooks = hooks;
}

export function setOperationStoreConfigForTests(options: {
  now?: () => number;
  ttlMs?: number;
  maxOperations?: number;
}): void {
  operationNow = options.now ?? operationNow;
  operationTtlMs = options.ttlMs ?? operationTtlMs;
  maxOperations = options.maxOperations ?? maxOperations;
}

export function clearOperationsForTests(): void {
  operations.clear();
  writeQueues.clear();
  operationTestHooks = {};
  operationTtlMs = DEFAULT_OPERATION_TTL_MS;
  maxOperations = DEFAULT_MAX_OPERATIONS;
  operationNow = () => Date.now();
}
