import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface ProjectFixture {
  root: string;
  write(relativePath: string, content: string): Promise<void>;
  read(relativePath: string): Promise<string>;
  cleanup(): Promise<void>;
  remove(): Promise<void>;
}

export async function createProjectFixture(files: Record<string, string>): Promise<ProjectFixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), "ast-mcp-test-"));
  const write = async (relativePath: string, content: string): Promise<void> => {
    const absolutePath = path.join(root, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, "utf8");
  };

  await write(
    "tsconfig.json",
    JSON.stringify(
      {
        compilerOptions: {
          strict: true,
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          allowJs: true,
        },
        include: ["src/**/*"],
      },
      null,
      2,
    ),
  );

  await Promise.all(Object.entries(files).map(([file, content]) => write(file, content)));

  return {
    root,
    write,
    read: (relativePath) => readFile(path.join(root, relativePath), "utf8"),
    cleanup: () => rm(root, { recursive: true, force: true }),
    remove: () => rm(root, { recursive: true, force: true }),
  };
}
