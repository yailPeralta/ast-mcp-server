export interface LocalRegistryConsumerOptions {
  output: string;
  expectedNode: "22.13.0" | "24";
  yarnEntry: string;
  npmEntry: string;
  transitiveNodeBin: string;
  expectedNodeSha256: string;
  expectedYarnSha256: string;
  expectedNpmSha256: string;
}

export function parseLocalRegistryArguments(argv: readonly string[]): LocalRegistryConsumerOptions;

export function assertLocalRegistryRuntime(
  expectedNode: LocalRegistryConsumerOptions["expectedNode"],
  actual?: string,
  nodeOptions?: string,
): void;

export interface LocalRegistryAuthorityOptions {
  expectedNode: LocalRegistryConsumerOptions["expectedNode"];
  yarnEntry: string;
  npmEntry: string;
  transitiveNodeBin: string;
  expectedNodeSha256: string;
  expectedYarnSha256: string;
  expectedNpmSha256: string;
}

export interface LocalRegistryPrivateRoots {
  home: string;
  temp: string;
}

export interface LocalRegistryFileAuthority {
  file: string;
  device: number;
  inode: number;
  mode: number;
  size: number;
  sha256: string;
  version: string;
}

export interface LocalRegistryAuthorities {
  node: LocalRegistryFileAuthority;
  yarn: LocalRegistryFileAuthority;
  npm: LocalRegistryFileAuthority;
  transitiveNode: LocalRegistryFileAuthority;
  path: string;
}

export function authenticateLocalRegistryAuthorities(
  options: LocalRegistryAuthorityOptions,
  privateRoots: LocalRegistryPrivateRoots,
): Promise<LocalRegistryAuthorities>;

export interface LocalRegistryExecutionOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface LocalRegistryExecutionResult {
  stdout: string;
  stderr: string;
}

export function executeAuthenticatedPackageManager(
  authorities: LocalRegistryAuthorities,
  manager: "yarn" | "npm",
  args: readonly string[],
  options?: LocalRegistryExecutionOptions,
): Promise<LocalRegistryExecutionResult>;

export interface TemporaryRootRemovalOptions {
  recursive: true;
  force: true;
  maxRetries: 3;
  retryDelay: 100;
}

export type TemporaryRootRemover = (
  root: string,
  options: TemporaryRootRemovalOptions,
) => Promise<void>;

export function removeTemporaryRoot(root: string, remove?: TemporaryRootRemover): Promise<void>;

export function completeBeforePublishing<T>(
  operation: () => Promise<T>,
  cleanups: readonly (() => Promise<void>)[],
  publish: (result: T) => Promise<void>,
): Promise<T>;
