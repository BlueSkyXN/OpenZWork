import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import {
  dataDirectory,
  relocateDataPath,
  relocateFileReference,
  DATA_ROOT_RELOCATED_MARKER,
} from "./index.js";

const roots: string[] = [];
async function fixture() {
  const base = await mkdtemp(join(tmpdir(), "data-root-gate-"));
  roots.push(base);
  const sourceRoot = join(base, "old", ".openzwork");
  await mkdir(sourceRoot, { recursive: true });
  return {
    sourceRoot,
    targetRoot: join(base, "new", ".openzwork"),
    stageRoot: join(base, "stage"),
  };
}
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("business data root admission", () => {
  it("blocks migration while either of two active users retains its lease", async () => {
    const { sourceRoot } = await fixture();
    const first = await dataDirectory.acquireUse(sourceRoot);
    const second = await dataDirectory.acquireUse(sourceRoot);
    await first();
    await expect(dataDirectory.exclusive(sourceRoot, async () => {})).rejects.toMatchObject({
      code: "DATA_DIRECTORY_IN_USE",
    });
    await second();
    await expect(dataDirectory.exclusive(sourceRoot, async () => "ready")).resolves.toBe("ready");
  });
  it("keeps new users outside an active migration and releases after failure", async () => {
    const { sourceRoot } = await fixture();
    await expect(
      dataDirectory.exclusive(sourceRoot, async () => {
        await expect(dataDirectory.acquireUse(sourceRoot)).rejects.toMatchObject({
          code: "ZCODE_FILE_LOCK_TIMEOUT",
        });
        throw new Error("synthetic copy failure");
      }),
    ).rejects.toThrow("synthetic copy failure");
    await (
      await dataDirectory.acquireUse(sourceRoot)
    )();
  });
  it("refuses a retired root instead of reopening its old snapshot", async () => {
    const { sourceRoot } = await fixture();
    await writeFile(join(sourceRoot, DATA_ROOT_RELOCATED_MARKER), "{}");
    await expect(dataDirectory.acquireUse(sourceRoot)).rejects.toMatchObject({
      code: "DATA_DIRECTORY_RELOCATED",
    });
  });
  it("maps owned files and URLs while preserving external, global, relative and remote references", async () => {
    const plan = await fixture();
    const path = join(plan.sourceRoot, "clipboard", "a b.png");
    expect(relocateDataPath(path, plan)).toBe(join(plan.targetRoot, "clipboard", "a b.png"));
    expect(relocateFileReference(pathToFileURL(path).href, plan)).toBe(
      pathToFileURL(join(plan.targetRoot, "clipboard", "a b.png")).href,
    );
    for (const untouched of [
      join(plan.sourceRoot, "cli", "config.json"),
      join(plan.sourceRoot, "v2", "setting.json"),
      join(`${plan.sourceRoot}-other`, "workspace"),
      "relative/file",
      "zcode-artifact://session/artifact",
      `remote:${path}`,
    ]) {
      expect(relocateDataPath(untouched, plan)).toBe(untouched);
    }
  });
});
