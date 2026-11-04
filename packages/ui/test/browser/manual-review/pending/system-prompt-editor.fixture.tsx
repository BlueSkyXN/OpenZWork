import { useZCodeSessionStore } from "@/store/zcodeSessionStore.js";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  createDefaultSystemPromptSettings,
  systemPromptSettingsSchema,
  type SystemPromptCatalog,
  type SystemPromptPreviewParams,
  type SystemPromptSettings,
  type ZCodeTaskMeta,
} from "@zcode/shared";
import type { IServiceAccessor, IBroadcastService } from "@zcode/services";
import { ServiceProvider } from "@/hooks/useServices.js";
import { ZCodeIntlProvider } from "@/i18n/IntlProvider.js";
import { StoreContext } from "@/store/StoreProvider.js";
import { createZCodeStore } from "@/store/index.js";
import { TabStoreProvider, useTabStoreApi } from "@/store/TabStoreProvider.js";
import { TooltipProvider } from "@/components/ui/tooltip.js";
import { SystemPromptEditor } from "@/settings/system-prompt/contract.js";
import "@/styles.css";

const params = new URLSearchParams(location.search);
const theme = params.get("theme") === "light" ? "light" : "dark";
const broadcast = {
  send: async () => {},
  onMessage: () => ({ dispose() {} }),
  acquireClaim: async () => ({ status: "unavailable" }),
  commitClaim: async () => {},
  releaseClaim: async () => {},
  tryClaim: async () => false,
} as IBroadcastService;
const store = createZCodeStore(broadcast);
store.getState().setTheme(theme);
useZCodeSessionStore.getState().setTaskListCache("/example/project", [
  {
    taskId: "example-session",
    title: "Example session",
    workspacePath: "/example/project",
  } as ZCodeTaskMeta,
]);
useZCodeSessionStore.getState().setActiveTaskId("/example/project", "example-session");
async function post(path: string, value: unknown) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
  if (!response.ok) throw new Error("Fixture service failed");
  return response.json();
}
const preview = (input: SystemPromptPreviewParams) => post("/prompt-preview", input);
const services = {
  zcodeAgentService: { readSessionSystemPrompt: (input: unknown) => post("/prompt-actual", input) },
} as unknown as IServiceAccessor;

function Fixture() {
  const tabs = useTabStoreApi();
  const [catalog, setCatalog] = useState<SystemPromptCatalog | null>(null);
  const [settings, setSettings] = useState<SystemPromptSettings>(() => ({
    ...createDefaultSystemPromptSettings(),
    sections: { role: { mode: "append", content: "SAVED_ROLE" } },
  }));
  const [saves, setSaves] = useState(0);
  useEffect(() => {
    tabs.getState().addTab("/example/project");
    void fetch("/prompt-catalog")
      .then((response) => response.json())
      .then(setCatalog);
  }, [tabs]);
  return (
    <main className="mx-auto max-w-6xl p-4 text-foreground">
      <h1 className="mb-4 text-ui-xl">System prompt editor</h1>
      <div className="mb-3 flex gap-3 text-ui-sm">
        <span data-testid="fixture-saves">{saves}</span>
        <button
          data-testid="fixture-external-update"
          onClick={() =>
            setSettings({
              ...createDefaultSystemPromptSettings(),
              sections: { role: { mode: "replace", content: "EXTERNAL_ROLE" } },
            })
          }
        >
          External update
        </button>
      </div>
      {catalog ? (
        <SystemPromptEditor
          catalog={catalog}
          settings={settings}
          preview={preview}
          onSave={async (next, previous) => {
            if (JSON.stringify(previous) !== JSON.stringify(settings))
              throw new Error("settings.systemPrompt.conflict");
            const committed = systemPromptSettingsSchema.parse(next);
            setSettings(committed);
            setSaves((value) => value + 1);
            return committed;
          }}
        />
      ) : null}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <ServiceProvider services={services}>
    <StoreContext.Provider value={store}>
      <TabStoreProvider>
        <ZCodeIntlProvider initialLocale={params.get("locale") === "en-US" ? "en-US" : "zh-CN"}>
          <TooltipProvider>
            <Fixture />
          </TooltipProvider>
        </ZCodeIntlProvider>
      </TabStoreProvider>
    </StoreContext.Provider>
  </ServiceProvider>,
);
