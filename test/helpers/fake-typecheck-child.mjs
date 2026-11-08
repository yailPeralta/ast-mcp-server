// Stand-in for the template type-check child (see angular-template-typecheck-supervisor.test.ts).
// Usage: fake-typecheck-child.mjs <mode> [payload]
import process from "node:process";
import { setInterval } from "node:timers";

const [mode, payload] = process.argv.slice(2);
const diagnostic = (message) => ({
  code: 1,
  category: "Error",
  file: "echo",
  line: null,
  column: null,
  message,
  start: null,
  length: null,
});
process.once("disconnect", () => process.exit(1));
const reply = (message) => process.send(message, () => process.exit(0));

process.once("message", (request) => {
  switch (mode) {
    case "reply":
      return reply(JSON.parse(payload));
    case "echo":
      return reply({
        v: 1,
        ok: true,
        before: [],
        after: [
          diagnostic(
            JSON.stringify({
              envKeys: Object.keys(process.env),
              execArgv: process.execArgv,
              request,
            }),
          ),
        ],
      });
    case "abort":
      return process.kill(process.pid, "SIGABRT");
    case "exit":
      return process.exit(Number(payload));
    case "malformed":
      return reply({ nonsense: true });
    case "oversized":
      return reply({
        v: 1,
        ok: true,
        before: Array.from({ length: 5001 }, () => diagnostic("x")),
        after: [],
      });
    case "hang":
      return setInterval(() => {}, 1000);
    default:
      return process.exit(0);
  }
});
