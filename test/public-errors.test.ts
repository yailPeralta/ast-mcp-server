import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import {
  MAX_PUBLIC_ERROR_MESSAGE_BYTES,
  PUBLIC_ERROR_CODES,
  PublicOperationalError,
  classifyPublicError,
  sanitizePublicText,
} from "../src/services/public-errors.js";
import { ProjectOperationSchedulerError } from "../src/services/project-operation-scheduler.js";
import { ProjectCapacityError } from "../src/services/project.js";
import { RequestContextError } from "../src/services/request-context.js";

const INTERNAL_MESSAGE = "An internal error occurred.";

const SECRET_CASES = [
  {
    value: 'failed to read "/home/yail/private/source.ts"',
    forbidden: ["/home/yail", "private/source.ts"],
  },
  {
    value: String.raw`failed to open C:\Users\Yail\private\source.ts`,
    forbidden: [String.raw`C:\Users`, "private", "source.ts"],
  },
  {
    value: String.raw`failed to watch \\server\share\private\source.ts`,
    forbidden: ["server", "share", "private", "source.ts"],
  },
  {
    value: String.raw`failed to resolve C:private\source.ts`,
    forbidden: [String.raw`C:private`, "source.ts"],
  },
  {
    value: 'failed to resolve "../private\nsource.ts"',
    forbidden: ["../private", "source.ts"],
  },
  {
    value:
      "Authorization: Bearer opaque-auth-value; api_key=opaque-api-value password=opaque-password",
    forbidden: ["opaque-auth-value", "opaque-api-value", "opaque-password"],
  },
  {
    value: "Authorization: Basic opaque-basic-value",
    forbidden: ["opaque-basic-value"],
  },
  {
    value: "Authorization=Digest opaque-digest-value",
    forbidden: ["opaque-digest-value"],
  },
  {
    value: "Authorization: opaque-authorization-value",
    forbidden: ["opaque-authorization-value"],
  },
  {
    value: "connection_string=mongodb://user:opaque-password@db.example/private",
    forbidden: ["opaque-password", "db.example", "/private"],
  },
  {
    value: "token=ghp_abcdefghijklmnopqrstuvwxyz123456",
    forbidden: ["ghp_abcdefghijklmnopqrstuvwxyz123456"],
  },
] as const;

describe("public error classification and redaction", () => {
  it("classifies every documented public code from a typed operational error", () => {
    for (const code of PUBLIC_ERROR_CODES) {
      expect(
        classifyPublicError(new PublicOperationalError(code, `Safe ${code} message.`)),
      ).toEqual({
        code,
        message: `Safe ${code} message.`,
      });
    }
  });

  it("maps unknown errors and arbitrary internal codes to a closed generic fallback", () => {
    expect(classifyPublicError(new Error("raw /home/yail/private.ts token=opaque"))).toEqual({
      code: "INTERNAL_ERROR",
      message: INTERNAL_MESSAGE,
    });
    expect(
      classifyPublicError(Object.assign(new Error("permission denied"), { code: "EACCES" })),
    ).toEqual({ code: "INTERNAL_ERROR", message: INTERNAL_MESSAGE });
    expect(
      classifyPublicError(
        Object.assign(new Error("export const privateSource = 'opaque-source';"), {
          code: "NOT_FOUND",
        }),
      ),
    ).toEqual({ code: "INTERNAL_ERROR", message: INTERNAL_MESSAGE });
  });

  it("classifies only the existing named operational errors structurally", () => {
    expect(classifyPublicError(new ProjectCapacityError())).toEqual({
      code: "PROJECT_CAPACITY_EXCEEDED",
      message: "Project session capacity exceeded.",
    });
    expect(classifyPublicError(new ProjectOperationSchedulerError("PROJECT_QUEUE_FULL"))).toEqual({
      code: "PROJECT_QUEUE_FULL",
      message: "Project operation queue is full.",
    });
    expect(classifyPublicError(new RequestContextError("REQUEST_CANCELLED"))).toEqual({
      code: "REQUEST_CANCELLED",
      message: "Request was cancelled.",
    });
  });

  it.each([
    {
      error: new Error('No tsconfig.json found at "/home/yail/private/tsconfig.json".'),
      code: "PROJECT_NOT_FOUND",
      message: "The project was not found.",
    },
    {
      error: new Error('Source file "private.ts" was not found in the project.'),
      code: "NOT_FOUND",
      message: "The requested target was not found.",
    },
    {
      error: new Error('Symbol "private" is ambiguous. Select one by line: private@1.'),
      code: "AMBIGUOUS_TARGET",
      message: "The requested target is ambiguous.",
    },
    {
      error: new Error("Workspace changed while the operation was being prepared."),
      code: "STALE_WORKSPACE",
      message: "The workspace changed. Retry the operation.",
    },
    {
      error: new Error("The operation is blocked by validation errors."),
      code: "MUTATION_BLOCKED",
      message: "The mutation is blocked.",
    },
    {
      error: new Error('Plan hash mismatch for operation "private-operation".'),
      code: "CONFLICT",
      message: "The operation conflicts with current state.",
    },
    {
      error: new Error("Scaffold file_path must be project-relative."),
      code: "INVALID_INPUT",
      message: "The request is invalid.",
    },
    {
      error: new Error(
        "Conflict: src/value.ts changed after the operation was prepared. No files were written.",
      ),
      code: "CONFLICT",
      message: "The operation conflicts with current state.",
    },
    {
      error: new Error("Operation target already exists: src/value.ts"),
      code: "CONFLICT",
      message: "The operation conflicts with current state.",
    },
    {
      error: new Error(
        "2 new TypeScript error(s) would be introduced. Prepare again with allow_new_errors=true only after explicit review.",
      ),
      code: "MUTATION_BLOCKED",
      message: "The mutation is blocked.",
    },
    {
      error: new Error('Prepared operation "private-operation" has expired.'),
      code: "NOT_FOUND",
      message: "The requested target was not found.",
    },
    {
      error: new Error('File "src/missing.ts" is not part of operation "private-operation".'),
      code: "NOT_FOUND",
      message: "The requested target was not found.",
    },
    {
      error: new Error("File path traversal is not allowed."),
      code: "INVALID_INPUT",
      message: "The request is invalid.",
    },
    {
      error: new Error("Windows absolute paths are not valid on this host."),
      code: "INVALID_INPUT",
      message: "The request is invalid.",
    },
    {
      error: new Error("Source file resolves outside the configured project root."),
      code: "INVALID_INPUT",
      message: "The request is invalid.",
    },
  ] as const)("classifies known legacy domain failures as $code", ({ error, code, message }) => {
    expect(classifyPublicError(error)).toEqual({ code, message });
  });

  it("fails closed without invoking hostile thrown-value accessors", () => {
    let getterCalls = 0;
    const hostile: Record<string, unknown> = {};
    Object.defineProperties(hostile, {
      code: {
        get: () => {
          getterCalls += 1;
          throw new Error("code getter executed");
        },
      },
      message: {
        get: () => {
          getterCalls += 1;
          throw new Error("message getter executed");
        },
      },
    });
    const revoked = Proxy.revocable(new Error("private"), {});
    revoked.revoke();

    expect(classifyPublicError(hostile)).toEqual({
      code: "INTERNAL_ERROR",
      message: INTERNAL_MESSAGE,
    });
    expect(classifyPublicError(revoked.proxy)).toEqual({
      code: "INTERNAL_ERROR",
      message: INTERNAL_MESSAGE,
    });
    expect(getterCalls).toBe(0);
  });

  it("rejects active proxies before invoking traps or accepting forged operational identity", () => {
    let trapCalls = 0;
    const hostile = new Proxy(
      {},
      {
        getPrototypeOf: () => {
          trapCalls += 1;
          return Error.prototype;
        },
        getOwnPropertyDescriptor: (_target, property) => {
          trapCalls += 1;
          if (property === "name") {
            return { configurable: true, enumerable: false, value: "ProjectCapacityError" };
          }
          if (property === "code") {
            return {
              configurable: true,
              enumerable: false,
              value: "PROJECT_CAPACITY_EXCEEDED",
            };
          }
          return undefined;
        },
      },
    );

    expect(classifyPublicError(hostile)).toEqual({
      code: "INTERNAL_ERROR",
      message: INTERNAL_MESSAGE,
    });
    expect(trapCalls).toBe(0);
  });

  it.each(SECRET_CASES)("redacts hostile text idempotently: $value", ({ value, forbidden }) => {
    const once = sanitizePublicText(value);
    const twice = sanitizePublicText(once);

    expect(twice).toBe(once);
    for (const fragment of forbidden) expect(once).not.toContain(fragment);
  });

  it("bounds sanitized messages by UTF-8 bytes without splitting a code point", () => {
    const sanitized = sanitizePublicText("é".repeat(MAX_PUBLIC_ERROR_MESSAGE_BYTES));

    expect(Buffer.byteLength(sanitized, "utf8")).toBeLessThanOrEqual(
      MAX_PUBLIC_ERROR_MESSAGE_BYTES,
    );
    expect(sanitized).not.toContain("�");
    expect(sanitized).toMatch(/truncated]$/);
  });
});
