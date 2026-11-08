import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { runTemplateTypeCheck } from "./services/angular-template-typecheck-core.js";
import { RequestSchema, type Response } from "./services/angular-template-typecheck-protocol.js";

/** Validates one IPC request and runs the core; it never throws. */
export async function handleRequest(
  raw: unknown,
  run: typeof runTemplateTypeCheck = runTemplateTypeCheck,
): Promise<Response> {
  const parsed = RequestSchema.safeParse(raw);
  return parsed.success ? run(parsed.data) : { v: 1, ok: false, reason: "check_failed" };
}

// One-shot child: serve a single request, reply, exit. A lost parent ends the process too.
const entry = process.argv[1];
if (
  process.send &&
  entry &&
  fs.realpathSync(entry) === fs.realpathSync(fileURLToPath(import.meta.url))
) {
  process.once("disconnect", () => process.exit(1));
  process.once("message", (raw) => {
    void handleRequest(raw).then((reply) => process.send!(reply, () => process.exit(0)));
  });
}
