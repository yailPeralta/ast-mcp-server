/// <reference types="node" />

export interface GitEvidenceAuthority {
  readonly binary: string;
  readonly realpath: string;
  readonly sha256: string;
}

export interface GitEnvironmentOptions {
  readonly identity?: Readonly<Record<string, string>>;
  readonly repositoryControls?: Readonly<Record<string, string>>;
  readonly workTree?: string;
}

export const TRUSTED_GIT_BINARY: "/usr/bin/git";
export const TRUSTED_SYSTEM_PATH: "/usr/bin:/bin";

export function assertNoAmbientGitControls(
  ambientEnvironment?: Readonly<Record<string, string | undefined>>,
): void;
export function createGitEnvironment(
  options?: GitEnvironmentOptions,
): Readonly<Record<string, string>>;
export function assertTrustedGitVersion(versionOutput: string): string;
export function inspectTrustedGitFile(): Promise<GitEvidenceAuthority>;
