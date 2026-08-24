import { afterEach, expect, it, vi } from "vitest";
import { prepareRename, clearOperationsForTests } from "../src/services/operations.js";
import {
  clearProjectSessions,
  getProjectRuntimeShutdownSnapshot,
} from "../src/services/project.js";
import { createProjectFixture, type ProjectFixture } from "./helpers/project-fixture.js";

let fixture: ProjectFixture | undefined;
// prettier-ignore
afterEach(async () => { clearOperationsForTests(); clearProjectSessions(); await fixture?.cleanup(); fixture = undefined; vi.unstubAllEnvs(); });

// prettier-ignore
it("pins a real compiler generation after retaining mutation history", async () => {
  vi.stubEnv("AST_SYMBOL_INDEX_PERSISTENCE", "disabled"); fixture = await createProjectFixture({ "src/value.ts": "export function value(input: number) { return input; }\n", "src/use.ts": 'import { value } from "./value.js"; export const used = value(1);\n' });
  await prepareRename({ projectRoot: fixture.root, filePath: "src/value.ts", symbolPath: "value", newName: "renamed" }); expect(getProjectRuntimeShutdownSnapshot()).toMatchObject({ admission: "open", mutation_history: true });
});
