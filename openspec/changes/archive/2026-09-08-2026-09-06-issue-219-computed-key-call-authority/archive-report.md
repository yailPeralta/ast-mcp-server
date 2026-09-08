# Archived: Computed-Key Call Authority

**Status:** Archived with retained warnings. Planning, implementation, strict verification, Judgment, settlement, canonical synchronization, and archive are complete. Delivery remains pending.

## Final record

| Field | Final state |
| --- | --- |
| Change | `2026-09-06-issue-219-computed-key-call-authority` |
| Archive date | 2026-09-08 |
| Local verification HEAD | `a4ae924` |
| Runtime target | `1ac6b84` |
| Main base | `7bb0c68` |
| Strict verification | PASS WITH WARNINGS; 3/3 requirements and 19/19 scenarios |
| Settlement | Complete |
| Judgment | APPROVED; zero dual-critical findings; warnings retained |
| RDD | `disabled/unmanaged` |

The admitted `verify-report.md` and terminal `reviews/ledger.json` remain byte-for-byte unchanged as audit evidence. The explicit final-state facts above supersede older intermediate HEAD references without rewriting those artifacts.

## Canonical synchronization

| Domain | Action | Requirement/scenario count |
| --- | --- | --- |
| `scoped-compiler-impact` | Modified `Preserve deferred classifier scope` | 1 requirement / 7 scenarios |
| `ast-explore-call-spines` | Modified `Exact authoritative spines` | 1 requirement / 6 scenarios |
| `affected-test-candidates` | Modified `Fail closed on untrusted evidence` | 1 requirement / 6 scenarios |

Total delta synchronized: **3 requirements / 19 scenarios**. Unrelated canonical requirements were preserved.

## Retained warnings

1. Generic constrained keys may miss compiler-derived alternatives.
2. Numeric exact and union literal keys remain unsupported or may regress.
3. Work-budget accounting may undercount key-by-receiver Cartesian work.
4. Public and TOON evidence may overstate support or completeness.
5. Selector-only endpoint deduplication may conflate different files.
6. An unresolved exact string key may be treated as complete.

These findings provide no correction authority under the terminal dual-critical contract.

## Delivery status

**Pending.** The local verification HEAD has not been pushed because the GitHub credential is expired. The next authorized action is to renew the credential, push `a4ae924`, and read back the remote result before claiming delivery or issue closure.

## Archive integrity

- All 14 task checkboxes are complete, including the archive task.
- The active change root was removed and moved mechanically to this archive path.
- Recursive pre-move versus post-move `diff -r` output was empty.
- No application/runtime-target, test, Git, GitHub, issue, review, Harness, or delegated operation was performed during archive; Node was used only to parse JSON/YAML for format validation.
