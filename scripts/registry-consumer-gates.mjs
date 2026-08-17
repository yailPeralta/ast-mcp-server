export const REGISTRY_CONSUMER_GATE_NAMES = Object.freeze([
  "lifecycle_scripts_disabled",
  "package_metadata",
  "tarball_integrity",
  "audit_signatures",
  "consumer_audit",
  "stdio_handshake",
  "exact_tool_inventory",
  "json_read",
  "toon_read",
  "default_sqlite_rebuild",
  "default_restart_hit",
  "default_private_cache",
  "explicit_disabled_no_cache",
  "mutation_only_default_no_cache",
  "explicit_canary",
  "rename_prepare_preview_apply_replay",
  "replace_prepare_preview_apply_replay",
  "scaffold_prepare_preview_apply_replay",
  "stale_conflict_fail_closed",
  "setup_idempotency",
]);

export function createPassedRegistryConsumerGates() {
  return Object.freeze(
    Object.fromEntries(REGISTRY_CONSUMER_GATE_NAMES.map((gate) => [gate, true])),
  );
}
