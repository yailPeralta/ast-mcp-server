# Isolated Harness output-validation candidate

These development patches implement the direction in [ADR0016](../../../docs/adr/0016-harness-output-validation.md) for #103.

Upstream: <https://github.com/deepseek-ai/deepseek-harness>, immutable base `cd5ef8148158c3a752a658978873241fdf8e2bbc` (`dsh-v0.1.2-alpha.1`). Preserve its MIT notice in `LICENSE`.

Apply an ordered, verified patch prefix only to a separate clean checkout of that base. A partial prefix exposes only its documented API; it is not a supported MCP output-validation runtime.

Full enforcement requires the candidate core and bridge together. Identical package version strings do not identify that pair. Source checks do not replace built CLI/Loader, recorded-session and installed-consumer verification.

The default baseline and active GUI are not modified. These files do not authorize package publication or installation.
