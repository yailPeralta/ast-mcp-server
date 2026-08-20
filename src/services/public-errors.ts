import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { types as utilTypes } from "node:util";

export const PUBLIC_ERROR_CODES = Object.freeze([
  "INVALID_INPUT",
  "PROJECT_NOT_FOUND",
  "PROJECT_CAPACITY_EXCEEDED",
  "PROJECT_QUEUE_FULL",
  "QUEUE_WAIT_TIMEOUT",
  "REQUEST_CANCELLED",
  "OPERATION_DEADLINE_EXCEEDED",
  "SERVER_SHUTTING_DOWN",
  "NOT_FOUND",
  "AMBIGUOUS_TARGET",
  "STALE_WORKSPACE",
  "INCOMPLETE_EVIDENCE",
  "MUTATION_BLOCKED",
  "CONFLICT",
  "INTERNAL_ERROR",
] as const);

export type PublicErrorCode = (typeof PUBLIC_ERROR_CODES)[number];

export const MAX_PUBLIC_ERROR_MESSAGE_BYTES = 2048;
export const MAX_PUBLIC_ERROR_RESPONSE_BYTES = 4096;
export const INTERNAL_ERROR_MESSAGE = "An internal error occurred.";
const MAX_PUBLIC_ERROR_INPUT_CHARS = 8192;
const TRUNCATION_SUFFIX = "... [truncated]";
const PUBLIC_ERROR_CODE_SET = new Set<string>(PUBLIC_ERROR_CODES);
const FIXED_PUBLIC_MESSAGES: Readonly<Record<PublicErrorCode, string>> = Object.freeze({
  INVALID_INPUT: "The request is invalid.",
  PROJECT_NOT_FOUND: "The project was not found.",
  PROJECT_CAPACITY_EXCEEDED: "Project session capacity exceeded.",
  PROJECT_QUEUE_FULL: "Project operation queue is full.",
  QUEUE_WAIT_TIMEOUT: "Project operation queue wait timed out.",
  REQUEST_CANCELLED: "Request was cancelled.",
  OPERATION_DEADLINE_EXCEEDED: "Operation deadline exceeded.",
  SERVER_SHUTTING_DOWN: "Server is shutting down.",
  NOT_FOUND: "The requested target was not found.",
  AMBIGUOUS_TARGET: "The requested target is ambiguous.",
  STALE_WORKSPACE: "The workspace changed. Retry the operation.",
  INCOMPLETE_EVIDENCE: "The required compiler evidence is incomplete.",
  MUTATION_BLOCKED: "The mutation is blocked.",
  CONFLICT: "The operation conflicts with current state.",
  INTERNAL_ERROR: INTERNAL_ERROR_MESSAGE,
});
const LEGACY_OPERATIONAL_CODES: Readonly<Record<string, ReadonlySet<PublicErrorCode>>> =
  Object.freeze({
    ProjectCapacityError: new Set<PublicErrorCode>(["PROJECT_CAPACITY_EXCEEDED"]),
    ProjectOperationSchedulerError: new Set<PublicErrorCode>([
      "PROJECT_QUEUE_FULL",
      "QUEUE_WAIT_TIMEOUT",
      "REQUEST_CANCELLED",
      "OPERATION_DEADLINE_EXCEEDED",
      "SERVER_SHUTTING_DOWN",
    ]),
    RequestContextError: new Set<PublicErrorCode>([
      "REQUEST_CANCELLED",
      "OPERATION_DEADLINE_EXCEEDED",
    ]),
  });
const LEGACY_MESSAGE_RULES: ReadonlyArray<{
  readonly code: PublicErrorCode;
  readonly pattern: RegExp;
}> = Object.freeze([
  {
    code: "PROJECT_NOT_FOUND",
    pattern: /^(?:No tsconfig\.json found at\b|Project session not found\.)/,
  },
  {
    code: "AMBIGUOUS_TARGET",
    pattern: /^(?:Ambiguous source file\b|Symbol .{0,1024} is ambiguous\.)/,
  },
  {
    code: "NOT_FOUND",
    pattern:
      /^(?:(?:Source file|Symbol) .{0,1024} (?:was not found|does not exist)|Prepared operation .{0,1024} (?:was not found or has expired|has expired)\.|File .{0,1024} is not part of operation .{0,1024}\.)/,
  },
  {
    code: "STALE_WORKSPACE",
    pattern:
      /^(?:Workspace changed\b|Project (?:configuration|source) changed during synchronization\.)/,
  },
  {
    code: "INCOMPLETE_EVIDENCE",
    pattern: /^Compiler-backed impact evidence is incomplete\.$/,
  },
  {
    code: "CONFLICT",
    pattern:
      /^(?:Conflict:|Plan hash mismatch\b|Persisted plan integrity mismatch\b|Operation id collision\b|Applied receipt conflict\b|Postimage recovery conflict\b|Operation target already exists\b|Another AST apply holds\b)/,
  },
  {
    code: "MUTATION_BLOCKED",
    pattern:
      /^(?:The operation is blocked\b|\d{1,10} new TypeScript error\(s\) would be introduced\.|Operation target\b|Symbol .{0,1024} (?:does not support structural rename|does not expose a replaceable body)|The structural operation produced no file changes\.)/,
  },
  {
    code: "INVALID_INPUT",
    pattern:
      /^(?:File path traversal is not allowed\.|Windows absolute paths are not valid on this host\.|Source file resolves outside the configured project root\.|Unsupported (?:UTF-16|non-UTF-8) source encoding\b|Persisted (?:operation|applied operation|prepared operation|project_root|original hash|updated hash|affected_files|diagnostic error delta|blocked status)\b|Scaffold file_path must\b|.{0,1024} is not a valid TypeScript identifier\.|.{0,1024} must (?:be|not|contain)\b|.{0,1024} requires\b|.{0,1024} exceeds \d+ characters\.)/,
  },
]);

export interface ClassifiedPublicError {
  readonly code: PublicErrorCode;
  readonly message: string;
}

export interface PublicErrorEnvelope {
  readonly error: {
    readonly code: PublicErrorCode;
    readonly message: string;
    readonly correlation_id: string;
  };
}

export interface RenderedPublicError {
  readonly envelope: PublicErrorEnvelope;
  readonly text: string;
}

export class PublicOperationalError extends Error {
  #brand = true;

  constructor(
    readonly code: PublicErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "PublicOperationalError";
  }

  static is(value: unknown): value is PublicOperationalError {
    try {
      return typeof value === "object" && value !== null && #brand in value;
    } catch {
      return false;
    }
  }
}

function redactAbsolutePaths(value: string): string {
  const traversalMarker = "__TRAVERSAL_PATH_REDACTED__";
  const quotedTraversalPath = /(?<=["'`])(?:[^"'`\n\r]*[\\/])?\.\.[\\/][^"'`\n\r]*?(?=["'`])/g;
  const labelledTraversalPath =
    /([=:]\s+)([^"'`:\n\r;,]*[ \t]+[^"'`:\n\r;,/\\]+[\\/]\.\.[\\/][^"'`:\n\r]*?)(?=\s*[:;,\n\r"'`)\]}]|(?:\.(?=\s|$))|$)/g;
  const diagnosticTraversalPath =
    /(\b(?:read|open|resolve|watch|parse)\s+)([^"'`:\n\r;,]*[\\/]\.\.[\\/][^"'`:\n\r]*?)(?=\s*[:;,\n\r"'`)\]}]|(?:\.(?=\s|$))|$)/gi;
  const spacedTraversalPath =
    /(?<=\s)([^"'`:\n\r;,]*[ \t]+[^"'`:\n\r;,/\\]+[\\/]\.\.[\\/][^"'`:\n\r]*?)(?=\s*[:;,\n\r"'`)\]}]|(?:\.(?=\s|$))|$)/g;
  const relativeTraversalPath =
    /(?:[^\s"'`:/${}\\]+[\\/])+\.\.[\\/][^"'`:\n\r]*?(?=\s*[:;,\n\r"'`)\]}]|(?:\.(?=\s|$))|$)/g;
  const directTraversalPath =
    /(?:^|(?<=[\s(]))\.\.[\\/][^"'`:\n\r]*?(?=\s*[:;,\n\r"'`)\]}]|(?:\.(?=\s|$))|$)/g;
  const uncPath =
    /(?:\\\\|\/{2})[^"'`\n\r]*?(?=\s*(?::(?=\s|$)|[;,\n\r"'`)\]}])|(?:\.(?=\s|$))|$)/g;
  const drivePath = /\b[A-Za-z]:[^"'`\n\r]*?(?=\s*(?::(?=\s|$)|[;,\n\r"'`)\]}])|(?:\.(?=\s|$))|$)/g;
  const posixPath =
    /(?<![A-Za-z0-9_./-])\/(?!\/)[^"'`\n\r]*?(?=\s*(?::(?=\s|$)|[;,\n\r"'`)\]}])|(?:\.(?=\s|$))|$)/g;

  const redacted = value
    .replace(quotedTraversalPath, traversalMarker)
    .replace(labelledTraversalPath, `$1${traversalMarker}`)
    .replace(diagnosticTraversalPath, `$1${traversalMarker}`)
    .replace(spacedTraversalPath, traversalMarker)
    .replace(relativeTraversalPath, traversalMarker)
    .replace(directTraversalPath, traversalMarker);

  return redacted
    .replace(drivePath, "[path-redacted]")
    .replace(uncPath, "[path-redacted]")
    .replace(posixPath, "[path-redacted]")
    .replaceAll(traversalMarker, "[path-redacted]");
}

function redactCredentials(value: string): string {
  return value
    .replace(
      /(?!(?:\bauthorization[ \t]*[:=])[ \t]*\[REDACTED\])(\bauthorization[ \t]*[:=])([ \t]*)[^\r\n;]+/gi,
      "$1$2[REDACTED]",
    )
    .replace(/(?!(?:\bbearer)[ \t]+\[REDACTED\])\bbearer[ \t]+[^\r\n;]+/gi, "Bearer [REDACTED]")
    .replace(
      /\b(api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|token|password|secret|credential|connection[-_ ]?string)\b\s*[:=]\s*(?!\[REDACTED\])(?:"[^"]*"|'[^']*'|[^\s,;}\]]+)/gi,
      "$1=[REDACTED]",
    )
    .replace(/\b([A-Za-z][A-Za-z0-9+.-]*:\/\/)[^\s"'`]+@/g, "$1[REDACTED]@")
    .replace(/\b(?:sk|ghp|github_pat|xox[baprs]-|AIza)[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]");
}

export function sanitizeSensitiveText(value: string): string {
  return redactCredentials(redactAbsolutePaths(value));
}

function truncateUtf8(value: string, maximumBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maximumBytes) return value;
  const suffixBytes = Buffer.byteLength(TRUNCATION_SUFFIX, "utf8");
  const source = Buffer.from(value, "utf8");
  let end = Math.max(0, maximumBytes - suffixBytes);
  while (end > 0 && (source[end]! & 0xc0) === 0x80) end -= 1;
  let prefix = source.subarray(0, end).toString("utf8");
  while (Buffer.byteLength(prefix + TRUNCATION_SUFFIX, "utf8") > maximumBytes) {
    prefix = prefix.slice(0, -1);
  }
  return prefix + TRUNCATION_SUFFIX;
}

export function sanitizePublicText(value: string): string {
  const boundedInput = value.slice(0, MAX_PUBLIC_ERROR_INPUT_CHARS);
  const singleLine = Array.from(boundedInput, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127 ? " " : character;
  }).join("");
  return truncateUtf8(sanitizeSensitiveText(singleLine), MAX_PUBLIC_ERROR_MESSAGE_BYTES);
}

function ownString(value: object, property: string): string | null {
  const descriptor = Object.getOwnPropertyDescriptor(value, property);
  return descriptor !== undefined && "value" in descriptor && typeof descriptor.value === "string"
    ? descriptor.value
    : null;
}

function codedError(error: unknown): ClassifiedPublicError | null {
  try {
    if (PublicOperationalError.is(error)) {
      const code = ownString(error, "code");
      const message = ownString(error, "message");
      if (code === null || message === null || !PUBLIC_ERROR_CODE_SET.has(code)) return null;
      return {
        code: code as PublicErrorCode,
        message: sanitizePublicText(message),
      };
    }

    if (!(error instanceof Error)) return null;
    const name = ownString(error, "name");
    const code = ownString(error, "code");
    if (name === null || code === null || !PUBLIC_ERROR_CODE_SET.has(code)) return null;
    const publicCode = code as PublicErrorCode;
    if (!LEGACY_OPERATIONAL_CODES[name]?.has(publicCode)) return null;
    return {
      code: publicCode,
      message: FIXED_PUBLIC_MESSAGES[publicCode],
    };
  } catch {
    return null;
  }
}

function knownLegacyError(error: unknown): ClassifiedPublicError | null {
  try {
    if (!(error instanceof Error)) return null;
    const message = ownString(error, "message");
    if (message === null) return null;
    const boundedMessage = message.slice(0, MAX_PUBLIC_ERROR_RESPONSE_BYTES);
    const match = LEGACY_MESSAGE_RULES.find(({ pattern }) => pattern.test(boundedMessage));
    return match === undefined
      ? null
      : { code: match.code, message: FIXED_PUBLIC_MESSAGES[match.code] };
  } catch {
    return null;
  }
}

export function classifyPublicError(error: unknown): ClassifiedPublicError {
  if (typeof error === "object" && error !== null && utilTypes.isProxy(error)) {
    return { code: "INTERNAL_ERROR", message: INTERNAL_ERROR_MESSAGE };
  }
  return (
    codedError(error) ??
    knownLegacyError(error) ?? {
      code: "INTERNAL_ERROR",
      message: INTERNAL_ERROR_MESSAGE,
    }
  );
}

function serializePublicError(
  code: PublicErrorCode,
  message: string,
  correlationId: string,
): RenderedPublicError {
  const envelope: PublicErrorEnvelope = {
    error: {
      code,
      message,
      correlation_id: correlationId,
    },
  };
  return { envelope, text: JSON.stringify(envelope) };
}

export function renderPublicError(error: unknown): RenderedPublicError {
  const classified = classifyPublicError(error);
  const correlationId = randomUUID();
  const initial = serializePublicError(classified.code, classified.message, correlationId);
  if (Buffer.byteLength(initial.text, "utf8") <= MAX_PUBLIC_ERROR_RESPONSE_BYTES) {
    return initial;
  }

  let lowerBudget = Buffer.byteLength(TRUNCATION_SUFFIX, "utf8");
  let upperBudget = Buffer.byteLength(classified.message, "utf8") - 1;
  let best = serializePublicError(classified.code, TRUNCATION_SUFFIX, correlationId);
  while (lowerBudget <= upperBudget) {
    const candidateBudget = Math.floor((lowerBudget + upperBudget) / 2);
    const candidate = serializePublicError(
      classified.code,
      truncateUtf8(classified.message, candidateBudget),
      correlationId,
    );
    if (Buffer.byteLength(candidate.text, "utf8") <= MAX_PUBLIC_ERROR_RESPONSE_BYTES) {
      best = candidate;
      lowerBudget = candidateBudget + 1;
    } else {
      upperBudget = candidateBudget - 1;
    }
  }
  return best;
}
