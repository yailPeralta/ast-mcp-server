# Issue #247 archived; delivery remains pending

The completed SDD change is archived after strict verification, terminal dual Judgment approval, final runtime-attempt settlement, and green CI for the exact PR #266 head. Archival records completion but grants no commit, push, review, merge, issue-closure, or delivery authority.

## Final status

| Field | Final value |
| --- | --- |
| Change | `2026-09-06-issue-247-honest-scoped-call-coverage` |
| Approved authority | Issue #247, still open |
| RDD | `disabled/unmanaged` |
| Base | `main@3b57de77d21a7514cc6436f9824ea85fee285d9e` |
| Implementation candidate | `0e3955ffe2f576b6f87f4c2e654eb0a15e89721e` |
| Archive source head | `e416336f941ee43c3fe6dd9d9561dbd1623b78ef` |
| Source tree at archive base | `3b579bd167f7a694f6d3fef4d8d6800774936f83` |
| Strict verification | PASS, 14/14 requirements and 25/25 scenarios |
| Verification evidence | `sha256:d8278ab4fbdf4766efafab62548570058a353a3adf3c3966021d9afe0bd9f07d` |
| Judgment | Terminal `APPROVED`; both judges approved; zero open confirmed severe findings |
| PR #266 delivery gate | Green for exact head `e416336f941ee43c3fe6dd9d9561dbd1623b78ef` |
| Archive | Complete on 2026-09-08 |
| Delivery | Pending ordinary repository authority |

## Runtime-attempt closure

The final bounded objective `sha256:a2b381d984e33f8f3cd3360c8c96f9a9c37bacfd5106969ac193e03f5f2b4ebf` completed with runtime status revision `sha256:1c71f969301c4063ee3e732c49fceed6b594dfa80db3419f4a9fe5ae24730464`. Ordinal 11 settled `passed` with finish identity `sha256:f782767aa96185f9dfa70d16e4c08c308531076d1a8b84260012d0e459b1075e`, finish tree `27e0765bfb810a2d2d75ea8fa7df0a03e06c1b4e`, evidence revision `sha256:d8278ab4fbdf4766efafab62548570058a353a3adf3c3966021d9afe0bd9f07d`, and zero changed lines.

## Exact PR chain

| PR | Exact head | Role |
| ---: | --- | --- |
| #249 | `4f1e60eef43b81bbafcdef90075713589e249c42` | Exploration |
| #250 | `5b3807f7e30846d72ce45a40a98139d95d3374fe` | Status routing |
| #251 | `4594faac0f4399f42486200d7ccc6092dfe81c7c` | Proposal |
| #252 | `fd32ab0c0fd443e28bee89cc0b0cc3a9ea9855b6` | Delta specifications |
| #253 | `bbf05f7f6b352ec92a24ec7ab79aaf1a544baed2` | Design |
| #254 | `ed34b0787ab088004e9b996a7af2695f58f5da3f` | Tasks and planning base |
| #255 | `22a4e867bceec9bd70b5b8509e4aae26b5122ddc` | U1 coverage contract |
| #280 | `32ce48b7d58cbd02ecb80829574c32a49e14e841` | U1 evidence |
| #256 | `cd90f26c03f27c883c7831e11033c38bc3cae82a` | U2 impact authority |
| #281 | `2300701e5a8a4337cfffdb7dc34a2a5e9dcb739f` | U2 evidence |
| #257 | `0e1d5dba1524524d2b39038ea3f19766b2de9f46` | U3 scoped direct calls |
| #282 | `e7b2e683ac22f759044f943b4b0caf0f3651030d` | U3 evidence |
| #258 | `1d8b15c95eb1516dc028bd5be01f36d3ad4c22ae` | U4 candidate completeness |
| #283 | `4b60124e7f9bd099598ebd27588e7607fc5b039c` | U4 evidence |
| #259 | `62e53463bd9af53f1dc40d33a07ff41bd0d2cf28` | U5 contract and audit |
| #260 | `1ab53a438c3c9a9002a9f56fb6362a2868c2c727` | Judgment ledger |
| #261 | `1b8de4f0216d49d3fb8d62211fe4bcde12210089` | R1A incoming uncertainty |
| #262 | `c435028ad3eaae4f63b51735887b11f4eb9f4aa2` | R1B benchmark evidence |
| #263 | `94cbbe8300cf6399beadc90b3f18a7d174112594` | R1C OpenSpec format |
| #264 | `0e3955ffe2f576b6f87f4c2e654eb0a15e89721e` | Terminal dual approval |
| #266 | `e416336f941ee43c3fe6dd9d9561dbd1623b78ef` | Strict verification and archive parent |

The verification record preserves exact successful run identities for PR #256 (`34182622615`, attempt 2) and PR #281 (`34182647317`, attempt 2). The final PR #266 green result is bound to its exact head above; no additional run identifier was supplied to this archive operation.

## Canonical specification merge

| Capability | Action | Delta | Canonical result |
| --- | --- | --- | --- |
| `scoped-compiler-impact` | Created from the complete source spec | 9 added requirements, 15 scenarios | 9 requirements, 15 scenarios |
| `affected-test-candidates` | Updated without weakening untouched behavior | 5 modified requirements, 10 scenarios | 7 requirements, 14 scenarios; 2 requirements and 4 scenarios preserved |

No requirement was removed or renamed. Delta-only `(Previously: ...)` notes were not copied into the canonical capability.

## Preserved evidence and snapshot interpretation

- `verify-report.md` remains byte-preserved as the strict verification snapshot.
- `reviews/ledger.json` remains byte-preserved as the terminal dual Judgment ledger.
- `apply-progress.json` and `tasks.md` remain historical snapshots; their earlier “unsettled” or “awaiting archive” wording does not override the final runtime status, exact-head CI fact, or this terminal archive record.
- All 28 persisted checklist tasks are checked.

## Delivery order

1. Review and deliver the archive-only PR containing the canonical spec sync, pure directory move, archived state update, and this report.
2. Keep issue #247 open until a maintainer separately confirms delivery and issue-closure policy.
3. Do not infer merge authority from Judgment, verification, CI, or archival.

## Exclusions and cleanup

No runtime, tests, source implementation, package, benchmark, Harness, issue, PR, review, commit, push, merge, or remote state was modified by this archive operation. Issue #219 computed-key classification, issue #220 external convergence, a `contains` producer, inherited #186/#188 authority, whole-project call-spine changes, and universal output-schema changes remain excluded.
