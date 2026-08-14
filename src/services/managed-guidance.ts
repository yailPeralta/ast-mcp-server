import { readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentId } from "./setup-wizard.js";
import {
  applyManagedFilePlan,
  canonicalizeFuturePath,
  captureManagedFilePreimage,
  createManagedFileApplyContext,
  hashBytes,
  verifyManagedFilePostimage,
  type ManagedFileApplyContext,
  type ManagedFileApplyHooks,
  type ManagedFilePlan,
  type ManagedFileStatus,
} from "./managed-file.js";

const BEGIN_MARKER = "<!-- ast-tool:structural-code-editing guidance v1 begin -->";
const END_MARKER = "<!-- ast-tool:structural-code-editing guidance v1 end -->";
const MARKER_NAMESPACE = "ast-tool:structural-code-editing guidance";

type GuidanceAgent = AgentId;
export type GuidanceStatus = ManagedFileStatus | "skill_only";

export interface ManagedGuidanceInstallation {
  agent: GuidanceAgent;
  status: GuidanceStatus;
  path?: string;
}

export interface ManagedGuidancePlan {
  installations: ManagedGuidanceInstallation[];
  files: ManagedFilePlan[];
}

export interface PlanManagedGuidanceOptions {
  agents: readonly GuidanceAgent[];
  sourceGuidancePath: string;
  environment?: NodeJS.ProcessEnv;
  homeDirectory?: string;
  workingDirectory?: string;
}

interface GuidanceDestination {
  agent: Exclude<GuidanceAgent, "hermes" | "copilot">;
  path: string;
  seed?: Buffer;
}

function configured(value: string | undefined, fallback: string, cwd: string): string {
  return path.resolve(cwd, value ?? fallback);
}

async function regularFileSize(filePath: string): Promise<number | undefined> {
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error(`Guidance source is not a regular file: ${filePath}`);
    return info.size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function openCodeConfigRoot(environment: NodeJS.ProcessEnv, home: string, cwd: string): string {
  if (environment.OPENCODE_CONFIG) {
    return path.dirname(path.resolve(cwd, environment.OPENCODE_CONFIG));
  }
  if (environment.OPENCODE_CONFIG_DIR) {
    return path.resolve(cwd, environment.OPENCODE_CONFIG_DIR);
  }
  return path.join(home, ".config", "opencode");
}

function safeGeminiContextFilename(value: unknown): string {
  const candidate =
    typeof value === "string"
      ? value
      : Array.isArray(value) && value.length === 1 && typeof value[0] === "string"
        ? value[0]
        : undefined;
  if (candidate === undefined) {
    throw new Error("Gemini context.fileName routing is ambiguous or unsupported.");
  }
  if (
    candidate.length === 0 ||
    path.isAbsolute(candidate) ||
    candidate !== path.basename(candidate) ||
    candidate === "." ||
    candidate === ".."
  ) {
    throw new Error("Gemini context.fileName must be one safe filename.");
  }
  return candidate;
}

async function geminiGuidancePath(home: string): Promise<string> {
  const root = path.join(home, ".gemini");
  const settingsPath = path.join(root, "settings.json");
  let settingsText: string;
  try {
    settingsText = await readFile(settingsPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return path.join(root, "GEMINI.md");
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(settingsText);
  } catch {
    throw new Error("Gemini settings.json is not valid JSON.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Gemini settings.json must contain an object.");
  }
  const context = (parsed as { context?: unknown }).context;
  if (context === undefined) return path.join(root, "GEMINI.md");
  if (typeof context !== "object" || context === null || Array.isArray(context)) {
    throw new Error("Gemini context settings are unsupported.");
  }
  const fileName = (context as { fileName?: unknown }).fileName;
  if (fileName === undefined) return path.join(root, "GEMINI.md");
  return path.join(root, safeGeminiContextFilename(fileName));
}

async function resolveDestinations(
  options: PlanManagedGuidanceOptions,
): Promise<Array<GuidanceDestination | { agent: "hermes" | "copilot" }>> {
  const environment = options.environment ?? process.env;
  const home = options.homeDirectory ?? os.homedir();
  const cwd = options.workingDirectory ?? process.cwd();
  const selected = new Set(options.agents);
  const claudePath = path.join(
    configured(environment.CLAUDE_CONFIG_DIR, path.join(home, ".claude"), cwd),
    "CLAUDE.md",
  );
  const result: Array<GuidanceDestination | { agent: "hermes" | "copilot" }> = [];

  for (const agent of options.agents) {
    if (agent === "hermes" || agent === "copilot") {
      result.push({ agent });
      continue;
    }
    if (agent === "claude") {
      result.push({ agent, path: claudePath });
      continue;
    }
    if (agent === "opencode") {
      const nativePath = path.join(openCodeConfigRoot(environment, home, cwd), "AGENTS.md");
      if ((await regularFileSize(nativePath)) !== undefined) {
        result.push({ agent, path: nativePath });
        continue;
      }
      const fallbackSize = await regularFileSize(claudePath);
      if (fallbackSize !== undefined && selected.has("claude")) {
        result.push({ agent, path: claudePath });
      } else if (fallbackSize !== undefined) {
        result.push({ agent, path: nativePath, seed: await readFile(claudePath) });
      } else {
        result.push({ agent, path: nativePath });
      }
      continue;
    }
    if (agent === "codex") {
      const root = configured(environment.CODEX_HOME, path.join(home, ".codex"), cwd);
      const override = path.join(root, "AGENTS.override.md");
      result.push({
        agent,
        path: (await regularFileSize(override)) ? override : path.join(root, "AGENTS.md"),
      });
      continue;
    }
    result.push({ agent, path: await geminiGuidancePath(home) });
  }

  return Promise.all(
    result.map(async (item) =>
      "path" in item ? { ...item, path: await canonicalizeFuturePath(item.path) } : item,
    ),
  );
}

function decodeUtf8(content: Buffer, destination: string): { bom: Buffer; text: string } {
  const bom = content.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))
    ? content.subarray(0, 3)
    : Buffer.alloc(0);
  const body = content.subarray(bom.length);
  if (body.includes(0)) throw new Error(`Guidance destination contains NUL bytes: ${destination}`);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(body);
  return { bom, text };
}

function newlineFor(text: string): "\r\n" | "\n" {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

function canonicalBlock(guidance: string, newline: "\r\n" | "\n"): string {
  const normalized = guidance.replaceAll("\r\n", "\n").replaceAll("\r", "\n").trimEnd();
  return [BEGIN_MARKER, normalized, END_MARKER].join(newline);
}

function postimageFor(content: Buffer, guidance: string, destination: string): Buffer {
  const { bom, text } = decodeUtf8(content, destination);
  const newline = newlineFor(text);
  const block = canonicalBlock(guidance, newline);
  const namespaceCount = text.split(MARKER_NAMESPACE).length - 1;
  const begins = text.split(BEGIN_MARKER).length - 1;
  const ends = text.split(END_MARKER).length - 1;
  if (namespaceCount === 0) {
    const separator =
      text.length === 0 ? "" : text.endsWith(newline) ? newline : `${newline}${newline}`;
    return Buffer.concat([bom, Buffer.from(`${text}${separator}${block}${newline}`, "utf8")]);
  }
  if (namespaceCount !== 2 || begins !== 1 || ends !== 1) {
    throw new Error(
      `Guidance destination contains malformed or unsupported managed markers: ${destination}`,
    );
  }
  const begin = text.indexOf(BEGIN_MARKER);
  const end = text.indexOf(END_MARKER);
  if (begin < 0 || end < begin) {
    throw new Error(`Guidance destination contains malformed managed markers: ${destination}`);
  }
  const afterEnd = end + END_MARKER.length;
  return Buffer.concat([
    bom,
    Buffer.from(`${text.slice(0, begin)}${block}${text.slice(afterEnd)}`, "utf8"),
  ]);
}

export async function planManagedGuidance(
  options: PlanManagedGuidanceOptions,
): Promise<ManagedGuidancePlan> {
  const guidancePath = path.resolve(options.sourceGuidancePath);
  if ((await regularFileSize(guidancePath)) === undefined) {
    throw new Error(`Bundled guidance is missing: ${guidancePath}`);
  }
  const guidanceBuffer = await readFile(guidancePath);
  const { text: guidance } = decodeUtf8(guidanceBuffer, guidancePath);
  if (guidance.trim().length === 0 || guidance.includes(MARKER_NAMESPACE)) {
    throw new Error("Bundled guidance must be non-empty and marker-free.");
  }

  const destinations = await resolveDestinations(options);
  const filesByPath = new Map<string, ManagedFilePlan>();
  const installations: ManagedGuidanceInstallation[] = [];

  for (const destination of destinations) {
    if (!("path" in destination)) {
      installations.push({ agent: destination.agent, status: "skill_only" });
      continue;
    }
    let file = filesByPath.get(destination.path);
    if (file === undefined) {
      const captured = await captureManagedFilePreimage(destination.path);
      const snapshot = captured.snapshot;
      const preimage = snapshot.exists ? captured.content! : (destination.seed ?? Buffer.alloc(0));
      const postimage = postimageFor(preimage, guidance, destination.path);
      const postimageSha256 = hashBytes(postimage);
      const status: ManagedFileStatus = !snapshot.exists
        ? "installed"
        : snapshot.sha256 === postimageSha256
          ? "unchanged"
          : "updated";
      file = { path: destination.path, snapshot, postimage, postimageSha256, status };
      filesByPath.set(destination.path, file);
    } else if (destination.seed !== undefined) {
      const seededPostimage = postimageFor(destination.seed, guidance, destination.path);
      if (!seededPostimage.equals(file.postimage)) {
        throw new Error(`Guidance aliases require incompatible postimages: ${destination.path}`);
      }
    }
    installations.push({ agent: destination.agent, path: destination.path, status: file.status });
  }

  return { installations, files: [...filesByPath.values()] };
}

export async function applyManagedGuidancePlan(
  plan: ManagedGuidancePlan,
  onApplied?: (file: ManagedFilePlan) => void | Promise<void>,
  context: ManagedFileApplyContext = createManagedFileApplyContext(),
  hooks: ManagedFileApplyHooks = {},
): Promise<void> {
  const authenticated: ManagedFilePlan[] = [];
  for (const file of plan.files) {
    for (const current of authenticated) {
      await verifyManagedFilePostimage(current, context);
    }
    await applyManagedFilePlan(file, context, hooks);
    authenticated.push(file);
    await onApplied?.(file);
  }
  for (const current of authenticated) {
    await verifyManagedFilePostimage(current, context);
  }
}
