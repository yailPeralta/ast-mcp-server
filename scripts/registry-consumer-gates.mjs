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

// Consumer `npm audit --omit=dev` exceptions. This list is the single source of truth for
// both the registry consumer smoke (verify-next) and promotion evidence validation.
//
// GHSA-fc5q-39xc-vjpf (npm advisory 1247710): picomatch <=4.0.7 ReDoS through single-branch
// repeated extglobs. No patched picomatch release exists. It is reachable at runtime through
// @ts-morph/common -> tinyglobby -> picomatch, but exploiting it needs an attacker-controlled
// glob: picomatch only sees the analyzed project's own tsconfig include/exclude patterns, and
// no MCP tool input becomes a glob. See #497 (repository audit) and #503 (consumer audit).
// Remove this entry as soon as a patched picomatch ships; until then it expires on the date
// below, after which the consumer audit fails again and forces a fresh review.
export const CONSUMER_AUDIT_ACCEPTED_ADVISORIES = Object.freeze([
  Object.freeze({
    id: "GHSA-fc5q-39xc-vjpf",
    source: 1247710,
    package: "picomatch",
    url: "https://github.com/advisories/GHSA-fc5q-39xc-vjpf",
    expires: "2027-02-18",
  }),
]);

const AUDIT_SEVERITIES = Object.freeze(["info", "low", "moderate", "high", "critical"]);
const ADVISORY_KEYS = Object.freeze(["id", "source", "package", "url", "expires"]);

function isPlainRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value, keys) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function rejected(reason) {
  return { ok: false, reason };
}

function activeAdvisories(now) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) return undefined;
  const today = now.toISOString().slice(0, 10);
  return CONSUMER_AUDIT_ACCEPTED_ADVISORIES.filter((advisory) => today <= advisory.expires);
}

function matchingAdvisory(packageName, via, advisories) {
  if (!isPlainRecord(via)) return undefined;
  return advisories.find(
    (advisory) =>
      advisory.package === packageName &&
      via.name === packageName &&
      via.dependency === packageName &&
      via.source === advisory.source &&
      via.url === advisory.url,
  );
}

/**
 * Decides whether an `npm audit --json` (report v2) result for the clean consumer passes.
 * Every reported vulnerability must be explained by an unexpired accepted advisory, either
 * directly or through dependents whose `via` only names explained packages. Anything else,
 * including an unknown shape or inconsistent counts, fails closed.
 */
export function evaluateConsumerAudit(report, now) {
  const advisories = activeAdvisories(now);
  if (advisories === undefined) return rejected("the audit clock is not a valid date.");
  if (!isPlainRecord(report) || report.auditReportVersion !== 2) {
    return rejected("the audit report is not an npm audit v2 report.");
  }
  const { vulnerabilities, metadata } = report;
  if (!isPlainRecord(vulnerabilities) || !isPlainRecord(metadata)) {
    return rejected("the audit report shape is not recognized.");
  }
  const counts = metadata.vulnerabilities;
  if (!isPlainRecord(counts) || !hasExactKeys(counts, [...AUDIT_SEVERITIES, "total"])) {
    return rejected("the audit vulnerability counts are not recognized.");
  }
  for (const value of Object.values(counts)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      return rejected("the audit vulnerability counts are not non-negative integers.");
    }
  }

  const names = Object.keys(vulnerabilities);
  const severityTotals = Object.fromEntries(AUDIT_SEVERITIES.map((severity) => [severity, 0]));
  const explained = new Set();
  const used = new Set();
  const dependents = new Map();
  for (const name of names) {
    const finding = vulnerabilities[name];
    if (
      !isPlainRecord(finding) ||
      finding.name !== name ||
      !AUDIT_SEVERITIES.includes(finding.severity) ||
      !Array.isArray(finding.via) ||
      finding.via.length === 0
    ) {
      return rejected(`audit finding ${name} has an unrecognized shape.`);
    }
    severityTotals[finding.severity] += 1;
    const references = finding.via.filter((via) => typeof via === "string");
    const direct = finding.via.filter((via) => typeof via !== "string");
    if (direct.length > 0) {
      if (references.length > 0) {
        return rejected(`audit finding ${name} mixes advisories with dependency references.`);
      }
      for (const via of direct) {
        const advisory = matchingAdvisory(name, via, advisories);
        if (advisory === undefined) {
          return rejected(`audit finding ${name} reports an advisory that is not accepted.`);
        }
        used.add(advisory);
      }
      explained.add(name);
    } else {
      dependents.set(name, references);
    }
  }

  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const [name, references] of dependents) {
      if (references.every((reference) => explained.has(reference))) {
        explained.add(name);
        dependents.delete(name);
        progressed = true;
      }
    }
  }
  if (dependents.size > 0) {
    return rejected(
      `audit findings ${[...dependents.keys()].sort().join(", ")} are not explained by an accepted advisory.`,
    );
  }

  if (
    counts.total !== names.length ||
    AUDIT_SEVERITIES.some((severity) => counts[severity] !== severityTotals[severity])
  ) {
    return rejected("the audit vulnerability counts do not match the reported findings.");
  }
  return {
    ok: true,
    accepted_advisories: CONSUMER_AUDIT_ACCEPTED_ADVISORIES.filter((advisory) =>
      used.has(advisory),
    ).map((advisory) => ({ ...advisory })),
  };
}

/** Checks recorded `accepted_audit_advisories` evidence against the reviewed exception list. */
export function validateAcceptedAuditAdvisories(value) {
  if (!Array.isArray(value)) return false;
  const seen = new Set();
  for (const recorded of value) {
    if (!isPlainRecord(recorded) || !hasExactKeys(recorded, ADVISORY_KEYS)) return false;
    const reviewed = CONSUMER_AUDIT_ACCEPTED_ADVISORIES.find((advisory) =>
      ADVISORY_KEYS.every((key) => advisory[key] === recorded[key]),
    );
    if (reviewed === undefined || seen.has(reviewed)) return false;
    seen.add(reviewed);
  }
  return true;
}
