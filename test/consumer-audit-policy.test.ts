import { describe, expect, it } from "vitest";

import {
  CONSUMER_AUDIT_ACCEPTED_ADVISORIES,
  evaluateConsumerAudit,
  validateAcceptedAuditAdvisories,
} from "../scripts/registry-consumer-gates.mjs";

const BEFORE_EXPIRY = new Date("2026-11-18T12:00:00.000Z");
const LAST_ACCEPTED_INSTANT = new Date("2027-02-18T23:59:59.999Z");
const FIRST_EXPIRED_INSTANT = new Date("2027-02-19T00:00:00.000Z");
const PICOMATCH_URL = "https://github.com/advisories/GHSA-fc5q-39xc-vjpf";

const ACCEPTED_PICOMATCH = {
  id: "GHSA-fc5q-39xc-vjpf",
  source: 1247710,
  package: "picomatch",
  url: PICOMATCH_URL,
  expires: "2027-02-18",
};

function picomatchAdvisory(overrides: Record<string, unknown> = {}) {
  return {
    source: 1247710,
    name: "picomatch",
    dependency: "picomatch",
    title: "picomatch vulnerable to ReDoS through single-branch repeated extglobs",
    url: PICOMATCH_URL,
    severity: "high",
    cwe: ["CWE-1333"],
    cvss: { score: 7.5, vectorString: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H" },
    range: "<=4.0.7",
    ...overrides,
  };
}

function entry(name: string, via: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    name,
    severity: "high",
    isDirect: name === "ast-mcp-server",
    via,
    effects: [],
    range: "*",
    nodes: [`node_modules/${name}`],
    fixAvailable: false,
    ...overrides,
  };
}

function counts(overrides: Record<string, number> = {}) {
  return { info: 0, low: 0, moderate: 0, high: 6, critical: 0, total: 6, ...overrides };
}

// Trimmed copy of `npm audit --omit=dev --json` (npm 11, audit report v2) for a clean
// consumer of ast-mcp-server@0.20.3, captured on 2026-11-18.
function realPicomatchReport(): Record<string, unknown> {
  return {
    auditReportVersion: 2,
    vulnerabilities: {
      "@ts-morph/common": entry("@ts-morph/common", ["tinyglobby"]),
      "ast-mcp-server": entry("ast-mcp-server", ["ts-morph"]),
      fdir: entry("fdir", ["picomatch"]),
      picomatch: entry("picomatch", [picomatchAdvisory()]),
      tinyglobby: entry("tinyglobby", ["fdir", "picomatch"]),
      "ts-morph": entry("ts-morph", ["@ts-morph/common"]),
    },
    metadata: {
      vulnerabilities: counts(),
      dependencies: {
        prod: 111,
        dev: 0,
        optional: 0,
        peer: 0,
        peerOptional: 0,
        total: 110,
      },
    },
  };
}

function withVulnerabilities(
  vulnerabilities: Record<string, unknown>,
  vulnerabilityCounts: Record<string, number>,
): Record<string, unknown> {
  const report = realPicomatchReport();
  return {
    ...report,
    vulnerabilities,
    metadata: { ...(report.metadata as object), vulnerabilities: vulnerabilityCounts },
  };
}

function realVulnerabilities(): Record<string, unknown> {
  return realPicomatchReport().vulnerabilities as Record<string, unknown>;
}

describe("consumer audit policy", () => {
  it("defines exactly one time-boxed exception for the unpatched picomatch advisory", () => {
    expect(CONSUMER_AUDIT_ACCEPTED_ADVISORIES).toEqual([ACCEPTED_PICOMATCH]);
    expect(Object.isFrozen(CONSUMER_AUDIT_ACCEPTED_ADVISORIES)).toBe(true);
    expect(Object.isFrozen(CONSUMER_AUDIT_ACCEPTED_ADVISORIES[0])).toBe(true);
  });

  it("passes a clean report without recording any accepted advisory", () => {
    const clean = withVulnerabilities({}, counts({ high: 0, total: 0 }));
    expect(evaluateConsumerAudit(clean, BEFORE_EXPIRY)).toEqual({
      ok: true,
      accepted_advisories: [],
    });
  });

  it("accepts the exact npm report where every finding traces to the picomatch advisory", () => {
    expect(evaluateConsumerAudit(realPicomatchReport(), BEFORE_EXPIRY)).toEqual({
      ok: true,
      accepted_advisories: [ACCEPTED_PICOMATCH],
    });
    expect(evaluateConsumerAudit(realPicomatchReport(), LAST_ACCEPTED_INSTANT).ok).toBe(true);
  });

  it("stops accepting the advisory after the expiry date to force a review", () => {
    const result = evaluateConsumerAudit(realPicomatchReport(), FIRST_EXPIRED_INSTANT);
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ reason: expect.stringMatching(/picomatch/u) });
  });

  it("fails closed when the clock is missing or invalid", () => {
    for (const now of [undefined, new Date(Number.NaN), "2026-11-18", Date.now()]) {
      expect(evaluateConsumerAudit(realPicomatchReport(), now as unknown as Date).ok).toBe(false);
    }
  });

  it("rejects a different advisory on picomatch", () => {
    for (const advisory of [
      picomatchAdvisory({
        source: 1099999,
        url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc",
      }),
      picomatchAdvisory({ source: 1099999 }),
      picomatchAdvisory({ url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc" }),
      picomatchAdvisory({ name: "other", dependency: "other" }),
    ]) {
      const report = withVulnerabilities(
        { ...realVulnerabilities(), picomatch: entry("picomatch", [advisory]) },
        counts(),
      );
      expect(evaluateConsumerAudit(report, BEFORE_EXPIRY).ok).toBe(false);
    }
  });

  it("rejects an extra advisory reported alongside the accepted one", () => {
    const report = withVulnerabilities(
      {
        ...realVulnerabilities(),
        picomatch: entry("picomatch", [
          picomatchAdvisory(),
          picomatchAdvisory({
            source: 1099999,
            url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc",
          }),
        ]),
      },
      counts(),
    );
    expect(evaluateConsumerAudit(report, BEFORE_EXPIRY).ok).toBe(false);
  });

  it("rejects another directly vulnerable package even with the accepted advisory id", () => {
    const report = withVulnerabilities(
      {
        ...realVulnerabilities(),
        minimatch: entry("minimatch", [
          picomatchAdvisory({ name: "minimatch", dependency: "minimatch" }),
        ]),
      },
      counts({ high: 7, total: 7 }),
    );
    expect(evaluateConsumerAudit(report, BEFORE_EXPIRY).ok).toBe(false);
  });

  it("rejects dependents that are not explained by the accepted advisory", () => {
    for (const vulnerabilities of [
      {
        ...realVulnerabilities(),
        tinyglobby: entry("tinyglobby", ["fdir", "picomatch", "braces"]),
      },
      { ...realVulnerabilities(), fdir: entry("fdir", []) },
      { ...realVulnerabilities(), fdir: entry("fdir", ["fdir"]) },
      { ...realVulnerabilities(), fdir: entry("fdir", ["picomatch", 7]) },
    ]) {
      expect(
        evaluateConsumerAudit(withVulnerabilities(vulnerabilities, counts()), BEFORE_EXPIRY).ok,
      ).toBe(false);
    }
    const unexplainedCycle = withVulnerabilities(
      {
        ...realVulnerabilities(),
        alpha: entry("alpha", ["beta"]),
        beta: entry("beta", ["alpha"]),
      },
      counts({ high: 8, total: 8 }),
    );
    expect(evaluateConsumerAudit(unexplainedCycle, BEFORE_EXPIRY).ok).toBe(false);
  });

  it("rejects counts that do not match the reported vulnerabilities", () => {
    for (const vulnerabilityCounts of [
      counts({ high: 5, total: 5 }),
      counts({ high: 6, total: 7, critical: 1 }),
      counts({ total: 7 }),
      counts({ high: 0, critical: 6 }),
      counts({ high: -1 }),
      counts({ high: 6.5 }),
      { ...counts(), extra: 0 },
      Object.fromEntries(Object.entries(counts()).filter(([key]) => key !== "info")),
    ]) {
      expect(
        evaluateConsumerAudit(
          withVulnerabilities(realVulnerabilities(), vulnerabilityCounts),
          BEFORE_EXPIRY,
        ).ok,
      ).toBe(false);
    }
  });

  it("rejects malformed or unknown report shapes", () => {
    const report = realPicomatchReport();
    for (const malformed of [
      null,
      [],
      "report",
      { ...report, auditReportVersion: 1 },
      { ...report, vulnerabilities: [] },
      { ...report, metadata: {} },
      { ...report, metadata: { vulnerabilities: null } },
      withVulnerabilities({ ...realVulnerabilities(), fdir: null }, counts()),
      withVulnerabilities(
        { ...realVulnerabilities(), fdir: entry("fdir", ["picomatch"], { name: "other" }) },
        counts(),
      ),
      withVulnerabilities(
        { ...realVulnerabilities(), fdir: entry("fdir", ["picomatch"], { severity: "urgent" }) },
        counts(),
      ),
      withVulnerabilities(
        { ...realVulnerabilities(), fdir: entry("fdir", "picomatch" as unknown as unknown[]) },
        counts(),
      ),
      withVulnerabilities(
        { ...realVulnerabilities(), picomatch: entry("picomatch", [null]) },
        counts(),
      ),
    ]) {
      expect(evaluateConsumerAudit(malformed, BEFORE_EXPIRY).ok).toBe(false);
    }
  });

  it("validates recorded evidence only against the reviewed exception list", () => {
    expect(validateAcceptedAuditAdvisories([])).toBe(true);
    expect(validateAcceptedAuditAdvisories([ACCEPTED_PICOMATCH])).toBe(true);
    for (const evidence of [
      undefined,
      null,
      {},
      [ACCEPTED_PICOMATCH, ACCEPTED_PICOMATCH],
      [{ ...ACCEPTED_PICOMATCH, expires: "2099-01-01" }],
      [{ ...ACCEPTED_PICOMATCH, source: 1 }],
      [{ ...ACCEPTED_PICOMATCH, extra: true }],
      [{ id: ACCEPTED_PICOMATCH.id }],
    ]) {
      expect(validateAcceptedAuditAdvisories(evidence)).toBe(false);
    }
  });
});
