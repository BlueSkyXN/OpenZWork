import { createRoot } from "react-dom/client";
import { ZCodeIntlProvider } from "@/i18n/IntlProvider.js";
import { TooltipProvider } from "@/components/ui/tooltip.js";
import { ProviderModelEditorFixture } from "./provider-model-editor.fixture.js";
import "@/styles.css";

const params = new URLSearchParams(location.search);
document.documentElement.className =
  params.get("theme") === "light" ? "light theme-zai-light" : "dark theme-zai-dark";
createRoot(document.getElementById("root")!).render(
  <ZCodeIntlProvider initialLocale={params.get("locale") === "zh-CN" ? "zh-CN" : "en-US"}>
    <TooltipProvider>
      <ProviderModelEditorFixture
        initialRecommendation={params.has("edit") ? "generic" : undefined}
      />
    </TooltipProvider>
  </ZCodeIntlProvider>,
);
