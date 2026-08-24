export interface RegistrySmokeToolClient {
  callTool(request: { name: string; arguments: Record<string, unknown> }): Promise<unknown>;
}

export function createFakeAgents(root: string): Promise<string>;

export function copyRegistryConsumerRunner(targetRoot: string): Promise<string>;

export function preparePrivateCanaryRoot(canaryRoot: string): Promise<void>;

export function preparePreviewApplyReplay(
  client: RegistrySmokeToolClient,
  name: string,
  arguments_: Record<string, unknown> & { project_root: string },
  expectedKind: string,
  expectedFiles: readonly string[],
  expectedPostimages: Readonly<Record<string, string>>,
): Promise<void>;
