import { lstat, mkdir, readdir, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isWithin(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}

async function prospectiveRealpath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if (!isMissing(error)) throw error;
    const parent = dirname(path);
    if (parent === path) throw error;
    return join(await prospectiveRealpath(parent), relative(parent, path));
  }
}

export async function createMemoryMigrationBoundary(storageRoot: string, sourceRoot: string) {
  const root = resolve(storageRoot);
  const legacyRoot = await realpath(dirname(dirname(sourceRoot)));
  const physicalSource = await realpath(sourceRoot);

  async function assertOutsideLegacy(path: string): Promise<void> {
    const physicalTarget = await prospectiveRealpath(path);
    // 源父目录链接可把普通 memories 叶子接到目标树；只解析旧 storage 祖先会漏过。
    if (isWithin(physicalSource, physicalTarget) || isWithin(physicalTarget, physicalSource)) {
      throw new Error(`Migration source and target physically overlap: ${sourceRoot}: ${path}`);
    }
    if (isWithin(legacyRoot, physicalTarget)) {
      throw new Error(`Migration target resolves inside legacy storage: ${path}`);
    }
  }

  async function assertDirectory(path: string, create = false): Promise<boolean> {
    const target = resolve(path);
    if (!isWithin(root, target)) throw new Error(`Migration target escapes storage: ${path}`);
    const segments = relative(root, target).split(sep).filter(Boolean);
    let current = root;
    for (let index = 0; index <= segments.length; index += 1) {
      await assertOutsideLegacy(current);
      let info;
      try {
        info = await lstat(current);
      } catch (error) {
        if (!isMissing(error)) throw error;
        if (!create) return false;
        await mkdir(current, { recursive: true });
        info = await lstat(current);
      }
      // 最终文件的 no-clobber 挡不住父目录链接；所有受控目录在使用前必须复验。
      if (info.isSymbolicLink() || !info.isDirectory()) {
        throw new Error(`Migration target is not a plain directory: ${current}`);
      }
      await assertOutsideLegacy(current);
      const segment = segments[index];
      if (segment !== undefined) current = join(current, segment);
    }
    return true;
  }

  async function assertTree(path: string): Promise<void> {
    if (!(await assertDirectory(path))) return;
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) await assertTree(child);
      else if (entry.isSymbolicLink()) {
        const target = await stat(child).catch((error: unknown) => {
          if (isMissing(error)) return undefined;
          throw error;
        });
        if (target?.isDirectory())
          throw new Error(`Migration target directory is a link: ${child}`);
      }
    }
  }

  async function assertMarker(markerPath: string): Promise<void> {
    await assertDirectory(dirname(markerPath));
    try {
      const info = await lstat(markerPath);
      if (!info.isFile() || info.isSymbolicLink()) {
        throw new Error(`Migration marker is not a plain file: ${markerPath}`);
      }
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }

  await assertDirectory(root);
  await assertDirectory(join(root, "cli"));
  await assertTree(join(root, "cli", "memories"));
  await assertMarker(join(root, "v2", "memory-migration.json"));
  return { assertDirectory, assertMarker };
}
