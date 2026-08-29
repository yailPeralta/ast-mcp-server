# Contributing to ast-mcp-server

Thank you for helping improve `ast-mcp-server`. Contributions use an issue-first workflow,
Conventional Commits, tests-first development, and small reviewable pull requests.

## Quick path

1. Search [existing issues](https://github.com/yailPeralta/ast-mcp-server/issues).
2. Open a focused issue and wait for a maintainer to add `status:approved`.
3. Create a conventionally named branch and implement one reviewable work unit.
4. Run the focused tests, then the repository quality checks.
5. Open a PR with `Closes #<issue-number>` and exactly one `type:*` label.

Do not start implementation before the issue is approved. If you plan to take an approved
issue, leave a comment first so work is not duplicated.

## Development setup

### Prerequisites

- Linux x64, the supported development and release environment
- Node.js 22.13.0 or newer; CI verifies exact Node.js 22.13.0 and the Node.js 24 line
- Corepack with Yarn 4.15.0, pinned by `packageManager` in `package.json`
- Git

Some filesystem and setup paths require GNU coreutils and procfs. See
[the support policy](docs/support.md) for the complete platform and trust boundary.

### Clone and verify

```bash
git clone https://github.com/yailPeralta/ast-mcp-server.git
cd ast-mcp-server
corepack enable
yarn install --immutable
yarn build
yarn test
```

`yarn start` launches the local stdio MCP server. For most changes, the focused smoke commands
described below provide a clearer verification result than starting the server interactively.

## Issue-first workflow

Every pull request must link an approved GitHub issue.

1. Search open and closed issues to avoid duplicates.
2. Open an issue that describes the problem, expected outcome, scope, and useful evidence.
3. Wait for maintainer review and the `status:approved` label.
4. Comment before beginning implementation.
5. Reference the issue from the PR body with `Closes #N`, `Fixes #N`, or `Resolves #N`.

GitHub Issues is the source of truth for bugs and implementation specs. Do not use a pull request
as the first place to propose a change.

### Labels

Pull requests require exactly one type label:

| Label                  | Use for                                                  |
| ---------------------- | -------------------------------------------------------- |
| `type:bug`             | A defect fix                                             |
| `type:feature`         | New behavior or an enhancement                           |
| `type:docs`            | Documentation-only changes                               |
| `type:refactor`        | Internal restructuring without intended behavior changes |
| `type:chore`           | Maintenance, dependencies, build, CI, tests, or style    |
| `type:breaking-change` | An incompatible public change                            |

`status:approved` authorizes implementation and PR delivery. `size:exception` records explicit
maintainer approval for a PR that must exceed the normal review-size budget. Do not invent or
apply substitute workflow labels.

## Make the change

### Branch names

Use `type/short-description`, in lowercase:

```text
feat/compiler-diagnostics
fix/stale-project-snapshot
docs/contributing-guide
```

Allowed prefixes are `feat`, `fix`, `chore`, `docs`, `style`, `refactor`, `perf`, `test`,
`build`, `ci`, and `revert`. The description may contain lowercase letters, numbers, hyphens,
dots, and underscores.

### Tests first

For behavior changes, follow RED -> GREEN -> REFACTOR:

1. Add or update a test that fails for the intended reason.
2. Implement the smallest change that makes it pass.
3. Refactor while keeping the focused test green.

Keep the code, tests, and documentation for one behavior in the same work unit. Avoid separate
"implementation," "tests," and "docs" commits when none is independently useful.

### Focused verification

Run the narrowest relevant test while developing:

```bash
yarn vitest run test/<area>.test.ts
```

Use the public-boundary smoke commands when your change affects them:

| Area            | Command                    |
| --------------- | -------------------------- |
| MCP transport   | `yarn test:mcp`            |
| MCP lifecycle   | `yarn test:lifecycle`      |
| CLI             | `yarn test:cli`            |
| Public errors   | `yarn test:errors`         |
| Packed package  | `yarn test:package`        |
| Harness adapter | `yarn test:dsh-adapter`    |
| Agent fixtures  | `yarn test:agent-fixtures` |

Record the exact commands and results in the PR. If no runtime boundary is affected, say why the
runtime smoke is not applicable.

## Commit convention

Use [Conventional Commits](https://www.conventionalcommits.org/):

```text
type(scope): concise outcome
```

Allowed types are `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`,
`style`, and `test`. The optional scope must be lowercase and may use letters, numbers, dots,
underscores, or hyphens.

Examples:

```text
feat(impact): expose bounded relationship evidence
fix(cli): preserve public error codes
docs: explain the local trust boundary
test(setup): cover concurrent destination changes
```

For a breaking change, add `!` and a `BREAKING CHANGE:` footer:

```text
feat(cli)!: rename the cache policy option

BREAKING CHANGE: replace --old-option with --new-option.
```

Never add `Co-Authored-By` or AI-attribution trailers.

## Pull requests

### Keep reviews focused

The normal PR budget is **400 changed lines**, measured as additions plus deletions. A reviewer
should be able to understand the change in roughly 60 minutes.

If the change exceeds that budget:

- split it into chained or stacked PRs by deliverable work unit; or
- obtain explicit maintainer approval and add `size:exception` when the diff cannot be split
  safely, such as an inseparable generated, vendor, or migration change.

An exception changes the review size, not the quality bar. Tests, CI, issue approval, and review
still apply.

### PR title and body

Use Conventional Commits format for the PR title. In the body, give reviewers a direct path:

```markdown
Closes #123

## Summary

- What outcome this PR delivers
- Why this is the chosen boundary

## Changes

| Area           | Change               |
| -------------- | -------------------- |
| `path/to/file` | What changed and why |

## Verification

- [x] `yarn vitest run test/<area>.test.ts` — <result>
- [x] Applicable smoke command — <result or N/A with reason>

## Review notes

- Review first: <highest-value file or decision>
- Out of scope: <explicit follow-up>
```

Add exactly one matching `type:*` label. For chained PRs, also identify the previous and next PR,
the current slice, and anything intentionally deferred.

### Before requesting review

- [ ] The linked issue has `status:approved`.
- [ ] The body contains `Closes #N`, `Fixes #N`, or `Resolves #N`.
- [ ] Exactly one `type:*` label is applied.
- [ ] The PR is within 400 changed lines, or `size:exception` was approved.
- [ ] Commits are reviewable work units and use Conventional Commits.
- [ ] Focused tests and applicable runtime smoke checks pass.
- [ ] Documentation is updated when behavior or public contracts change.
- [ ] No secrets, private source, absolute private paths, or credentials appear in evidence.
- [ ] No `Co-Authored-By` or AI-attribution trailers are present.

## Automated checks

CI runs on pushes and pull requests for Node.js 22.13.0 and Node.js 24. It verifies formatting,
linting, types, tests, build output, MCP/CLI/package boundaries, dependency audit, package shape,
workflow policy, and whitespace.

Run the main checks locally before requesting review:

```bash
yarn format:check
yarn lint
yarn typecheck
yarn test
yarn build
yarn test:mcp
yarn test:errors
yarn test:lifecycle
yarn test:cli
yarn test:package
yarn test:dsh-adapter
yarn audit
yarn pack --dry-run --json
node scripts/workflow-policy-check.mjs
git diff --check
```

All applicable checks must pass before merge. If a check cannot run locally, explain the reason
and leave the PR unready until CI provides the missing evidence.

## Security reports

Do **not** open a public issue for a suspected vulnerability. Follow [SECURITY.md](SECURITY.md)
for the private reporting channel, required evidence, redaction rules, and supported security
boundary.

## Collaboration

Be warm, direct, and specific. Critique the code or decision, not the person. Lead review comments
with the actionable point and explain the technical reason when it is not obvious.

For compatibility questions, collect the bounded environment evidence listed in
[the support policy](docs/support.md) before opening an issue. Never attach credentials, private
source, raw cache contents, or unsanitized absolute paths.
