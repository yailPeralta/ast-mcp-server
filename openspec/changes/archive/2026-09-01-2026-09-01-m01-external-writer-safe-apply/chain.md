# M-01 delivery chain

This draft tracker integrates approved issue [#127](https://github.com/yailPeralta/ast-mcp-server/issues/127). It must not merge until every child work unit is reviewed and accumulated into this branch.

## Dependency order

```text
main ← tracker ← planning-1 ← planning-2 ← impl-1 ← impl-2 ← impl-3 ← impl-4 ← impl-5
```

## Review units

| Unit       | Boundary                                                            | Expected authored lines |
| ---------- | ------------------------------------------------------------------- | ----------------------: |
| planning-1 | Exploration and proposal                                            |                     233 |
| planning-2 | Specification, design, tasks, and SDD state                         |                 283–313 |
| impl-1     | Test-only phase hooks and deterministic REDs                        |                 340–390 |
| impl-2     | Generic authenticated publication primitive and managed-file parity |                 320–380 |
| impl-3     | Operations adapters and creation/replacement GREEN                  |                 330–390 |
| impl-4     | Owned rollback and typed public mapping                             |                 330–390 |
| impl-5     | Invariants, support docs, complete gates, verification, and archive |                 280–360 |

Every child targets its immediate predecessor, stays at or below 400 authored changed lines, includes focused/runtime/rollback evidence, and marks its own position with `📍`. DeepSeek Harness apply remains absent and denied.
