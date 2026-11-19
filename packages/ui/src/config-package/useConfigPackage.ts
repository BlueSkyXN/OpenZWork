import { useEffect, useRef, useState } from "react";
import {
  CONFIG_PACKAGE_CATEGORIES,
  type ConfigApplyResult,
  type ConfigCategory,
  type ConfigPreview,
  type ConfigRow,
  type ConfigCounts,
} from "@zcode/shared";
import type { ConfigPackageSectionProps } from "./contract.js";
type IConfigPackageService = NonNullable<ConfigPackageSectionProps["service"]>;
import { usePlatform } from "@/hooks/usePlatform.js";

type Screen =
  | { page: "closed" | "categories" | "confirm" | "loading" }
  | { page: "preview"; preview: ConfigPreview }
  | { page: "exported"; counts: ConfigCounts }
  | { page: "imported"; result: ConfigApplyResult; rows: ConfigRow[] }
  | { page: "error"; code: string };
export const rowId = (row: Pick<ConfigRow, "category" | "key">) =>
  JSON.stringify([row.category, row.key]);

export function useConfigPackage(service: IConfigPackageService | undefined) {
  const platform = usePlatform();
  const [screen, setScreen] = useState<Screen>({ page: "closed" });
  const [categories, setCategories] = useState<ConfigCategory[]>([...CONFIG_PACKAGE_CATEGORIES]);
  const [selected, setSelected] = useState(new Set<string>());
  const generation = useRef(0),
    active = useRef<string | null>(null),
    working = useRef(false);
  useEffect(
    () => () => {
      generation.current++;
      working.current = false;
      if (active.current) void service?.releasePreview(active.current).catch(() => {});
      active.current = null;
    },
    [service],
  );
  const close = () => {
    if (working.current) return;
    generation.current++;
    if (active.current) void service?.releasePreview(active.current).catch(() => {});
    active.current = null;
    setScreen({ page: "closed" });
  };
  async function run(action: (owner: IConfigPackageService, epoch: number) => Promise<Screen>) {
    if (working.current || !service) return;
    working.current = true;
    const epoch = ++generation.current;
    setScreen({ page: "loading" });
    try {
      const next = await action(service, epoch);
      if (epoch === generation.current) setScreen(next);
    } catch (error) {
      if (epoch === generation.current) {
        const message = error instanceof Error ? error.message : "";
        const code = message.match(/config-package\.([a-z-]+)/u)?.[1] ?? "operation";
        setScreen({ page: "error", code });
      }
    } finally {
      if (epoch === generation.current) working.current = false;
    }
  }
  return {
    screen,
    categories,
    selected,
    available: !!service && !!platform.selectSaveFilePath,
    close,
    openExport: () => {
      setCategories([...CONFIG_PACKAGE_CATEGORIES]);
      setScreen({ page: "categories" });
    },
    toggleCategory: (category: ConfigCategory) =>
      setCategories((old) =>
        old.includes(category) ? old.filter((value) => value !== category) : [...old, category],
      ),
    confirm: () => setScreen({ page: "confirm" }),
    back: () => setScreen({ page: "categories" }),
    save: () =>
      run(async (owner) => {
        const path = await platform.selectSaveFilePath!("OpenZWork.openzwork-config.gz");
        if (!path) return { page: "closed" };
        const { counts } = await owner.exportToFile(path, categories);
        return { page: "exported", counts };
      }),
    openImport: () =>
      run(async (owner, epoch) => {
        const path = await platform.selectFile();
        if (!path) return { page: "closed" };
        const preview = await owner.previewFile(path);
        if (epoch !== generation.current) {
          await owner.releasePreview(preview.previewId);
          return { page: "closed" };
        }
        active.current = preview.previewId;
        setSelected(new Set(preview.rows.filter((row) => row.status === "new").map(rowId)));
        return { page: "preview", preview };
      }),
    toggle: (id: string) =>
      setSelected((old) => {
        const next = new Set(old);
        if (!next.delete(id)) next.add(id);
        return next;
      }),
    apply: () =>
      run(async (owner) => {
        if (screen.page !== "preview") throw new Error("config-package.expired");
        const { preview } = screen;
        const result = await owner.applyPreview(
          preview.previewId,
          preview.rows
            .filter((row) => selected.has(rowId(row)))
            .map(({ category, key }) => ({ category, key })),
        );
        await owner.releasePreview(preview.previewId);
        active.current = null;
        return { page: "imported", result, rows: preview.rows };
      }),
  };
}
