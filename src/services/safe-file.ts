import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";

export function assertSafeOperationFile(
  projectRoot: string,
  absolutePath: string,
  displayPath: string,
): void {
  const fileStat = lstatSync(absolutePath);
  if (fileStat.isSymbolicLink()) {
    throw new Error(`Operation target must not be a symbolic link: ${displayPath}`);
  }
  if (!fileStat.isFile()) {
    throw new Error(`Operation target is not a regular file: ${displayPath}`);
  }
  const canonicalPath = realpathSync(absolutePath);
  const samePath =
    process.platform === "win32"
      ? canonicalPath.toLowerCase() === absolutePath.toLowerCase()
      : canonicalPath === absolutePath;
  if (!samePath) {
    throw new Error(`Operation target traverses a symbolic link: ${displayPath}`);
  }
  if (process.platform !== "win32" && fileStat.nlink !== 1) {
    throw new Error(`Operation target must have exactly one hard link: ${displayPath}`);
  }
  const uid = process.getuid?.();
  if (uid !== undefined && fileStat.uid !== uid) {
    throw new Error(`Operation target is not owned by the current user: ${displayPath}`);
  }
  const relative = path.relative(projectRoot, canonicalPath);
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`)) {
    throw new Error(`Operation target escapes the project root: ${displayPath}`);
  }
}
