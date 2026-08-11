# Security Policy

## Supported versions

Security fixes are provided for the latest published minor release and the current `main` development line. During the v0.7.0 release-candidate cycle, the support window is:

| Version                            | Supported                          |
| ---------------------------------- | ---------------------------------- |
| `main` / v0.7.0 release candidates | Yes                                |
| 0.6.x                              | Yes, until v0.7.0 becomes `latest` |
| 0.5.x and earlier                  | No                                 |

This project supports trusted single-user local stdio use. The current v0.7.0 target supports Linux x64 only when GNU coreutils `mv` provides `--update=none-fail`, with Node.js 22.5.0 or the current Node.js 24 line. Other Linux architectures, systems without that primitive, macOS and Windows are unverified. Remote, untrusted and multi-tenant use is outside the supported security boundary.

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
