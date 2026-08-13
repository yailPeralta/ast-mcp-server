# Design: Improve Agent Setup

## Technical Approach

Keep `agent-setup.ts` as the effect orchestrator; pure planners own selection, compatibility, and physical skill destinations. A six-entry registry delegates volatile MCP contracts to versioned adapters. Global preflight precedes sequential, convergent mutation and verification.

## Architecture Decisions

| Question                             | Alternatives and tradeoff                                                              | Decision and rationale                                                                                                                                                                                                                                                                                    |
| ------------------------------------ | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| How is client variation isolated?    | Central branching is initially smaller; generic config edits bypass client validation. | Versioned adapters own detect/inspect/mutate/verify. Public CLIs serve five clients; OpenCode alone uses bounded JSONC mutation because its CLI ignores custom routing.                                                                                                                                   |
| How is interaction controlled?       | A prompt dependency adds supply-chain surface; line input lacks toggles.               | A pure checkbox reducer plus raw-TTY adapter; one idempotent cleanup owner restores raw mode, cursor, and listeners on every exit.                                                                                                                                                                        |
| How are shared skills handled?       | Per-client writes duplicate work.                                                      | Canonicalize through the nearest existing ancestor `realpath`, group physical identities, preflight all groups, write once, and report logical bindings.                                                                                                                                                  |
| How are failures diagnosable safely? | Raw provider output is useful but may expose secrets.                                  | One UUID correlation ID per setup; timeout/verification failures emit at most one 2 KiB structured stderr event with only ID, agent, operation, error class, and elapsed bucket. Stable errors carry the same ID and bounded allow-listed reason; never arguments, paths, environment, stdout, or stderr. |

## Sequence Flows

```mermaid
sequenceDiagram
  actor U as User
  participant C as CLI
  participant A as Adapters
  participant T as Raw TTY
  C->>A: detect and classify in registry order
  A-->>C: compatible or disabled(reason)
  C->>T: enter raw mode; render checked compatible choices
  U->>T: Up/Down/Space/Enter
  T->>C: reduced selection
  alt confirm
    C->>T: cleanup once
    C-->>U: selected IDs
  else Escape/Ctrl-C/reject/error/signal
    C->>T: cleanup once
    C-->>U: cancelled/error; no writes
  end
```

```mermaid
sequenceDiagram
  participant C as CLI
  participant O as Orchestrator
  participant A as Adapter
  participant S as Skill store
  C->>O: request + correlation ID
  O->>A: compatibility, trust, and MCP inspection
  O->>S: classify all physical destinations
  alt conflict/unknown/untrusted/timeout
    O-->>C: bounded failure; no writes
  else preflight passes
    O->>S: write each physical skill once
    loop selected adapters
      O->>A: mutate if missing
      O->>A: verify command/args/health
      alt mutation or verification failure
        O-->>C: correlated partial result; stop
      else verified/current
        A-->>O: logical outcome
      end
    end
    O-->>C: ordered success
  end
```

`all` resolves after detection; any detected incompatible contract aborts. Explicit IDs also reject unavailable clients. Commands are shell-free, argument-array based, timeout/output bounded. Retry re-inspects retained work. OpenCode resolves `OPENCODE_CONFIG`, then `OPENCODE_CONFIG_DIR/opencode.json`, then standard config; `jsonc-parser` edits only `mcp.ast` using snapshot-checked temp rename, preserving comments, unrelated keys, and mode, then same-environment `debug config`/`mcp list` verification.

Gemini preflight runs the admitted `gemini mcp list` contract in setup's working directory and parses its exact untrusted-folder marker into `blocked_untrusted_folder`. This produces actionable `AGENT_TRUST_REQUIRED`, performs no writes, and is never a registration conflict. Unknown trust evidence fails closed. Fixture admission and acceptance tests cover a correct existing registration reported disconnected in an untrusted folder, then a trusted-folder rerun that verifies it as current.

## Interfaces / Contracts

```ts
type Compatibility =
  | { status: "compatible"; contract: string }
  | { status: "unavailable" | "incompatible" | "blocked_untrusted_folder"; reason: string };
interface AgentAdapter {
  detect(r: Runtime): Promise<Compatibility>;
  inspect(c: Context): Promise<Inspection>;
  mutate(c: Context): Promise<void>;
  verify(c: Context): Promise<Verification>;
}
```

## File Changes

| File                                                                                             | Action        | Description                                                 |
| ------------------------------------------------------------------------------------------------ | ------------- | ----------------------------------------------------------- |
| `src/services/agent-targets.ts`, `src/services/agent-target-adapters/*.ts`                       | Modify/Create | Registry and six adapters.                                  |
| `src/services/agent-setup.ts`, `src/services/skill-installer.ts`                                 | Modify        | Preflight, destination plans, correlation, partial results. |
| `src/services/setup-wizard.ts`, `src/services/{checkbox-state,raw-tty}.ts`, `src/cli.ts`         | Modify/Create | Checkbox flow and cleanup.                                  |
| `src/services/opencode-config.ts`, `package.json`, `yarn.lock`                                   | Create/Modify | Atomic routed JSONC edit.                                   |
| `test/`, `scripts/`, `README.md`, `CHANGELOG.md`, `docs/adr/0001-secure-yarn-and-agent-setup.md` | Modify        | RED tests, fixtures, smoke, policy.                         |

## Testing Strategy

RED-first Vitest covers reducer/cleanup exits, registry and exact adapter fixtures, `all`/explicit selection, trust classifications, destination deduplication/conflicts, timeout/correlation redaction, OpenCode precedence/no-clobber, idempotency, verification failure, and partial retry. CLI/package smoke covers six identities, spaces, stable JSON, and failure/retry. No browser E2E.

## Threat Matrix

| Boundary                 | Applicability                                   | Safe/failure behavior and RED tests |
| ------------------------ | ----------------------------------------------- | ----------------------------------- |
| Documentation-like paths | N/A — no project-file execution classification. | None.                               |
| Git repository selection | N/A — no VCS operation.                         | None.                               |
| Commit state             | N/A — no commit operation.                      | None.                               |
| Push state               | N/A — no push operation.                        | None.                               |
| PR commands              | N/A — no PR automation.                         | None.                               |

## Migration / Rollout

No migration. Before release, smoke both mixed-version directions: prior CLI against new additive registrations/skill paths must leave them untouched, and new CLI against prior two-client state must converge without schema reset. Rollback is allowed only if both checks pass; revert code/dependency while retaining valid user state, then rerun prior-client smoke. Unknown mixed-version output fails rollout.

## Open Questions

None.
