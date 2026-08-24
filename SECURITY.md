# Security Policy

## Supported versions

Security fixes are provided for the exact version currently identified by the npm registry's `latest` dist-tag and for the current `main` development line. The support window is registry-authoritative:

| Release state                               | Supported |
| ------------------------------------------- | --------- |
| `main` / `Unreleased`                       | Yes       |
| Exact npm version currently tagged `latest` | Yes       |
| Earlier npm versions                        | No        |
| Unpublished release candidates              | No        |

This project supports trusted single-user local stdio use; the supported operating-system and architecture boundary remains Linux x64 only. The local `0.11.2` recovery candidate requires Node.js `>=22.13.0`, with evidence targeted at exact Node.js 22.13.0 and the governed Node.js 24 major. Published v0.10.0 retains its immutable Node.js 22.13.0/24 release matrix. Managed setup mutation requires GNU coreutils 9.7 `mv --update=none-fail --exchange --no-copy --no-target-directory`, GNU coreutils `ln -L -T`, and procfs descriptor-relative paths at `/proc/self/fd` with `O_DIRECTORY`/`O_NOFOLLOW`. The candidate's default SQLite cache also relies on Linux ownership, mode, no-follow, link-count and inode-identity checks; it does not defend against a malicious same-UID process. Other Linux architectures and systems without those primitives are unverified, as are macOS and Windows. Remote, untrusted, and multi-tenant use is outside the supported security boundary.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Email `yaildeveloper@gmail.com` with the subject `ast-mcp-server security report` and include:

- affected version or commit;
- impact and required attacker access;
- minimal reproduction steps;
- whether source mutation, credentials or local paths may have been exposed;
- a safe way to coordinate follow-up.

Do not include live API keys, tokens, credentials, private source bodies or production connection strings. Replace any necessary secret-shaped evidence with `[REDACTED]` and use a disposable fixture where possible.

A maintainer will acknowledge the report within five business days and provide an initial triage result within ten business days. Remediation and coordinated disclosure timing depend on severity, exploitability and release impact; no universal fix deadline is promised.

## Disclosure and scope

Please allow time for a fix and package readback before public disclosure. Reports are evaluated against the documented local stdio trust boundary: the server runs with the invoking user's filesystem permissions and is not an OS sandbox. Vulnerabilities that cross the compiler-authority, reviewed mutation, path-containment, credential-redaction, package-provenance or release-integrity boundaries remain in scope.
