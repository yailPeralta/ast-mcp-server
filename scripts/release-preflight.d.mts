export const OFFICIAL_NPM_REGISTRY: "https://registry.npmjs.org";
export const PUBLISH_AUTHORIZATION_FILE: "publish-authorization.json";
export const PREPARED_PACKAGE_FILE: "prepared-package.json";
export const PROMOTION_AUTHORIZATION_FILE: "promotion-authorization.json";
export const RELEASE_MODES: readonly ["publish-next", "verify-next", "promote-latest"];
export const RELEASE_EVIDENCE_FILES: readonly [
  "registry-metadata.json",
  "npm-audit-signatures.json",
  "registry-consumer.json",
];

export type ReleaseMode = (typeof RELEASE_MODES)[number];
export type ReleaseEvidenceFile = (typeof RELEASE_EVIDENCE_FILES)[number];

export interface ReleaseDispatchInput {
  mode: unknown;
  sha: unknown;
  version: unknown;
  verification_run_id: unknown;
  selected_sha: unknown;
  selected_ref: unknown;
}

export interface ValidatedReleaseDispatch {
  mode: ReleaseMode;
  sha: string;
  version: string;
  verification_run_id: string | null;
  selected_sha: string;
  selected_ref: "refs/heads/main";
}

export interface PublishReadbackState {
  state:
    "eligible_to_publish" | "already_published_needs_verification" | "absent_requires_new_dispatch";
  publish: boolean;
}

export interface RegistryReadback {
  package_name: "ast-mcp-server";
  version: string;
  git_head: string;
  engines_node: ">=22.5.0";
  integrity: string;
  tarball: string;
  attestation_url: string;
  predicate_type: "https://slsa.dev/provenance/v1";
  next: string;
  latest: string;
}

export interface VerificationEvidence {
  schema_version: 1;
  status: "pass";
  mode: "verify-next";
  package_name: "ast-mcp-server";
  version: string;
  sha: string;
  verification_run_id: string;
  registry: "https://registry.npmjs.org";
  integrity: string;
  member_hashes: Record<ReleaseEvidenceFile, string>;
  member_sizes: Record<ReleaseEvidenceFile, number>;
}

export interface VerificationEvidenceInput {
  sha: string;
  version: string;
  verification_run_id: string;
  integrity: string;
  members: Record<ReleaseEvidenceFile, Uint8Array>;
}

export function releaseEvidenceDirectory(sha: string, version: string): string;
export function releasePreparationDirectory(sha: string, version: string): string;
export function releaseArtifactName(sha: string, version: string): string;
export function validateTrustedPublishingNpmVersion(value: string): string;
export function validateEphemeralNpmConfiguration(input: {
  userconfig: string;
  runner_temp: string;
  repository_root: string;
}): { userconfig: string; runner_temp: string };
export function validateReleaseDispatch(input: ReleaseDispatchInput): ValidatedReleaseDispatch;
export function selectSuccessfulCiRun(
  runs: readonly Record<string, unknown>[],
  expectedSha: string,
): Record<string, unknown> & { id: number };
export function validatePackReport(
  report: unknown,
  expectedVersion: string,
): { package_name: "ast-mcp-server"; version: string; file_count: number };
export function buildTrustedPublishArguments(tarballPath: string): string[];
export interface PackedPackageManifest extends Record<string, unknown> {
  name: "ast-mcp-server";
  version: string;
  gitHead: string;
}
export function bindPackedPackageIdentity(
  packageMetadata: unknown,
  sha: string,
  version: string,
): PackedPackageManifest;
export function validatePackedPackageIdentity(
  packageMetadata: unknown,
  sha: string,
  version: string,
): PackedPackageManifest;
export interface PublishAuthorizationRecord {
  schema_version: 1;
  status: "pass";
  mode: "publish-next-authorization";
  package_name: "ast-mcp-server";
  version: string;
  sha: string;
  ci_run_id: number;
  registry: "https://registry.npmjs.org";
}
export function buildPublishAuthorizationRecord(input: {
  sha: string;
  version: string;
  ci_run_id: number;
}): PublishAuthorizationRecord;
export function validatePublishAuthorizationRecord(
  record: unknown,
  expected: { sha: string; version: string },
): PublishAuthorizationRecord;
export interface PreparedPackageRecord {
  schema_version: 1;
  status: "pass";
  mode: "publish-next-prepared-package";
  package_name: "ast-mcp-server";
  version: string;
  sha: string;
  ci_run_id: number;
  registry: "https://registry.npmjs.org";
  npm_version: string;
  pack_file_count: number;
  authorization_sha256: string;
  tarball_file: string;
  tarball_size: number;
  tarball_sha256: string;
  tarball_integrity: string;
}
export interface PreparedPackageRecordInput {
  sha: string;
  version: string;
  ci_run_id: number;
  npm_version: string;
  pack_file_count: number;
  authorization: Uint8Array;
  tarball: Uint8Array;
}
export function buildPreparedPackageRecord(
  input: PreparedPackageRecordInput,
): PreparedPackageRecord;
export function validatePreparedPackageRecord(
  record: unknown,
  expected: Pick<PreparedPackageRecordInput, "sha" | "version" | "authorization" | "tarball">,
): PreparedPackageRecord;
export function classifyPublishReadback(
  metadata: unknown,
  expectedSha: string,
  phase: "preflight" | "ambiguous",
): PublishReadbackState;
export function validateRegistryReadback(
  metadata: unknown,
  expectedVersion: string,
  expectedSha: string,
): RegistryReadback;
export function validateConsumerReport(
  report: unknown,
  expectedVersion: string,
  expectedSha: string,
): Record<string, unknown>;
export function validateAuditSignaturesReport(
  report: unknown,
  expectedRegistry: string,
): Record<string, unknown>;
export function buildVerificationEvidence(input: VerificationEvidenceInput): VerificationEvidence;
export function validateVerificationEvidence(
  evidence: unknown,
  expected: VerificationEvidenceInput,
): VerificationEvidence;
export interface PromotionGateRecordInput {
  sha: string;
  version: string;
  verification_run_id: string;
  artifact_id: number;
  integrity: string;
  verification_evidence: Uint8Array;
}
export interface PromotionGateRecord {
  schema_version: 1;
  status: "pass";
  mode: "promote-latest-authorization";
  package_name: "ast-mcp-server";
  version: string;
  sha: string;
  verification_run_id: string;
  artifact_id: number;
  registry: "https://registry.npmjs.org";
  integrity: string;
  verification_evidence_sha256: string;
}
export function buildPromotionGateRecord(input: PromotionGateRecordInput): PromotionGateRecord;
export function validatePromotionGateRecord(
  record: unknown,
  expected: Omit<PromotionGateRecordInput, "artifact_id">,
): PromotionGateRecord;
export function validatePromotionAuthorization(input: {
  verification_run_id: string;
  environment: string;
  npm_token_present: boolean;
}): { verification_run_id: string; environment: "production" };
export interface ReleaseCredentialBoundary {
  github_token_present: boolean;
  gh_token_present: boolean;
  node_auth_token_present: boolean;
  npm_token_present: boolean;
  oidc_token_present: boolean;
  oidc_url_present: boolean;
}
export function validateReleaseCredentialBoundary<
  T extends
    | "validate-environment"
    | "authorize-publish"
    | "prepare-publish"
    | "publish-next"
    | "verify-next"
    | "validate-promotion"
    | "promote-latest",
>(phase: T, credentials: ReleaseCredentialBoundary): ReleaseCredentialBoundary & { phase: T };
export function validatePackageManagerEnvironment(
  environment: Record<string, string | undefined>,
): true;
export function validateSetupNodeNpmUserconfig(value: unknown): true;
export function buildNpmChildEnvironment(
  sourceEnvironment: Record<string, string | undefined>,
  options: {
    includeNodeAuthToken?: boolean;
    includeOidc?: boolean;
    userconfig: string;
  },
): Record<string, string | undefined>;
export function classifyPromotionReadback(
  metadata: unknown,
  expectedVersion: string,
  expectedSha: string,
): {
  state: "eligible_to_promote" | "already_promoted";
  promote: boolean;
};
