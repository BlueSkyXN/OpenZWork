import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir, platform, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
const assetPrefix = "zcode-tui-runtime/";
const manifestAssetKey = `${assetPrefix}manifest.json`;
const packageEntryPath = "node_modules/@zcode/tui/dist/index.js";
const manifestFileName = "manifest.json";
export const loadTuiRuntime = async () => {
    const sea = await import("node:sea");
    if (!sea.isSea()) {
        return await import("@zcode/tui");
    }
    const runtimeDirectory = await ensureSeaTuiRuntime(sea);
    return await import(pathToFileURL(join(runtimeDirectory, packageEntryPath)).href);
};
const ensureSeaTuiRuntime = async (sea) => {
    const manifest = readManifest(sea);
    const cacheDirectory = join(cacheBaseDirectory(), __CLI_VERSION__, manifest.target, manifest.hash);
    const markerPath = join(cacheDirectory, manifestFileName);
    if (await isCacheCurrent(markerPath, manifest)) {
        return cacheDirectory;
    }
    const temporaryDirectory = `${cacheDirectory}.tmp-${process.pid}-${Date.now()}`;
    await rm(temporaryDirectory, {
        force: true,
        recursive: true,
    });
    await mkdir(temporaryDirectory, {
        recursive: true,
    });
    for (const file of manifest.files) {
        const asset = sea.getRawAsset(`${assetPrefix}${file.path}`);
        const bytes = Buffer.from(asset);
        const actualHash = createHash("sha256").update(bytes).digest("hex");
        if (actualHash !== file.sha256) {
            throw new Error(`SEA TUI asset hash mismatch for ${file.path}`);
        }
        const outputPath = join(temporaryDirectory, file.path);
        await mkdir(dirname(outputPath), {
            recursive: true,
        });
        await writeFile(outputPath, bytes);
        await chmod(outputPath, file.mode ?? modeForPath(file.path));
    }
    await writeFile(markerPathForDirectory(temporaryDirectory), JSON.stringify(manifest, null, 2));
    await rm(cacheDirectory, {
        force: true,
        recursive: true,
    });
    await mkdir(dirname(cacheDirectory), {
        recursive: true,
    });
    await rename(temporaryDirectory, cacheDirectory);
    return cacheDirectory;
};
const readManifest = (sea) => {
    const raw = sea.getAsset(manifestAssetKey, "utf8");
    const manifest = JSON.parse(raw);
    if (manifest.version !== 1 || !manifest.hash || !Array.isArray(manifest.files)) {
        throw new Error("Invalid SEA TUI runtime manifest.");
    }
    return manifest;
};
const isCacheCurrent = async (markerPath, expected) => {
    if (!existsSync(markerPath))
        return false;
    try {
        const current = JSON.parse(await readFile(markerPath, "utf8"));
        return current.hash === expected.hash && current.target === expected.target;
    }
    catch {
        return false;
    }
};
const cacheBaseDirectory = () => {
    const home = homedir();
    if (platform() === "darwin" && home) {
        return join(home, "Library", "Caches", "zcode", "sea-assets");
    }
    if (platform() === "win32") {
        return join(process.env.LOCALAPPDATA ?? join(home || tmpdir(), "AppData", "Local"), "zcode", "Cache", "sea-assets");
    }
    return join(process.env.XDG_CACHE_HOME ?? join(home || tmpdir(), ".cache"), "zcode", "sea-assets");
};
const markerPathForDirectory = (directory) => join(directory, manifestFileName);
const modeForPath = (filePath) => /\.(?:dll|dylib|node|so)$/i.test(filePath) ? 0o755 : 0o644;
