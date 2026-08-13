export interface AgentFixtureInput {
  agent: "gemini" | "copilot";
  operation: string;
  version: string;
  command: string[];
  cwd: string;
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface AgentFixture extends Omit<AgentFixtureInput, "cwd"> {
  schemaVersion: 1;
  cwd: "<WORKING_DIRECTORY>";
  sha256: string;
}

export function normalizeAgentFixture(input: AgentFixtureInput): AgentFixture;
export function admitAgentFixture(
  directory: string,
  input: AgentFixtureInput,
): Promise<{ fileName: string; fixture: AgentFixture }>;
export function verifyAgentFixtureDirectory(directory: string): Promise<{ checked: number }>;
