import { expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { projectMemoryDirectoryName } from "@zcode/shared/data-directory";
import { cliStorageRelocation } from "./index.js";

it("rejects live roots and refuses to merge conflicting memory identities", async () => {
  const root = await mkdtemp(join(tmpdir(), "cli-relocation-contract-"));
  const plan = {
    sourceRoot: join(root, "source"),
    targetRoot: join(root, "target"),
    stageRoot: join(root, "stage"),
  };
  try {
    await expect(
      cliStorageRelocation.relocate({ ...plan, stageRoot: plan.sourceRoot }),
    ).rejects.toThrow(/staging/);
    const memoryRoot = join(plan.stageRoot, "cli/memories/projects");
    const old = join(
      memoryRoot,
      projectMemoryDirectoryName(join(plan.sourceRoot, "workspace/default")),
    );
    const next = join(
      memoryRoot,
      projectMemoryDirectoryName(join(plan.targetRoot, "workspace/default")),
    );
    await mkdir(old, { recursive: true });
    await mkdir(next, { recursive: true });
    await writeFile(join(old, "MEMORY.md"), "original");
    await writeFile(join(next, "MEMORY.md"), "conflicting");
    await expect(cliStorageRelocation.relocate(plan)).rejects.toThrow(/different memory/);
    expect(await readFile(join(old, "MEMORY.md"), "utf8")).toBe("original");
    expect(await readFile(join(next, "MEMORY.md"), "utf8")).toBe("conflicting");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
