import { Buffer } from "node:buffer";
import type { ProjectIdentity } from "./project-status.js";
import {
  INTERNAL_ERROR_MESSAGE,
  MAX_PUBLIC_ERROR_RESPONSE_BYTES,
  sanitizePublicText,
  type PublicErrorCode,
} from "./public-errors.js";

export const MAX_RUNTIME_FAILURE_EVENT_BYTES = 8192;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TOOL_NAME_PATTERN = /^ast_[a-z0-9_]{1,64}$/;
const PROJECT_ID_PATTERN = /^project_[0-9a-f]{20}$/;
const CONFIG_ID_PATTERN = /^config_[0-9a-f]{20}$/;

export interface ToolFailureEventInput {
  readonly correlationId: string;
  readonly toolName: string;
  readonly code: PublicErrorCode;
  readonly message: string;
  readonly projectIdentity?: ProjectIdentity;
}

export interface ToolFailureEvent {
  readonly event: "tool_failure";
  readonly version: 1;
  readonly correlation_id: string;
  readonly tool: string;
  readonly code: PublicErrorCode;
  readonly message: string;
  readonly project_id?: string;
  readonly config_id?: string;
}

function normalizeProjectIdentity(identity: ProjectIdentity | undefined): {
  readonly project_id?: string;
  readonly config_id?: string;
} {
  if (identity === undefined || !PROJECT_ID_PATTERN.test(identity.project_id)) return {};
  return {
    project_id: identity.project_id,
    ...(identity.config_id !== null && CONFIG_ID_PATTERN.test(identity.config_id)
      ? { config_id: identity.config_id }
      : {}),
  };
}

export function renderToolFailureEvent(input: ToolFailureEventInput): string {
  const identity = normalizeProjectIdentity(input.projectIdentity);
  const event: ToolFailureEvent = {
    event: "tool_failure",
    version: 1,
    correlation_id: UUID_PATTERN.test(input.correlationId)
      ? input.correlationId
      : "invalid-correlation-id",
    tool: TOOL_NAME_PATTERN.test(input.toolName) ? input.toolName : "unknown_tool",
    code: input.code,
    message: sanitizePublicText(input.message),
    ...(identity.project_id === undefined ? {} : { project_id: identity.project_id }),
    ...(identity.config_id === undefined ? {} : { config_id: identity.config_id }),
  };
  let rendered = JSON.stringify(event);
  if (Buffer.byteLength(rendered, "utf8") + 1 > MAX_RUNTIME_FAILURE_EVENT_BYTES) {
    rendered = JSON.stringify({ ...event, message: INTERNAL_ERROR_MESSAGE });
  }
  if (Buffer.byteLength(rendered, "utf8") + 1 > MAX_RUNTIME_FAILURE_EVENT_BYTES) {
    return JSON.stringify({
      event: "tool_failure",
      version: 1,
      correlation_id: event.correlation_id,
      tool: "unknown_tool",
      code: "INTERNAL_ERROR",
      message: INTERNAL_ERROR_MESSAGE.slice(0, MAX_PUBLIC_ERROR_RESPONSE_BYTES),
    } satisfies ToolFailureEvent);
  }
  return rendered;
}

export function emitToolFailureEvent(input: ToolFailureEventInput): void {
  process.stderr.write(`${renderToolFailureEvent(input)}\n`);
}

// prettier-ignore
export function emitCompilerWorkerEvent(input: { readonly kind: "idle" | "crash" | "ambiguity"; readonly generation: number; readonly correlationId?: string; readonly count?: number }): void {
  const event = { event: "compiler_worker", version: 1, kind: input.kind, generation: Number.isSafeInteger(input.generation) ? input.generation : 0, correlation_id: input.correlationId && UUID_PATTERN.test(input.correlationId) ? input.correlationId : undefined, count: input.count === undefined ? undefined : Math.max(0, Math.min(128, Math.trunc(input.count))) }; process.stderr.write(`${JSON.stringify(event)}\n`);
}
