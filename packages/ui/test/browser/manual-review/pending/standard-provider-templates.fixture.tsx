import { createRoot } from "react-dom/client";
import { ZCodeIntlProvider } from "@/i18n/IntlProvider.js";
import { TooltipProvider } from "@/components/ui/tooltip.js";
import { ProviderDetailFeedbackBoundary } from "@/settings/model-provider-section/ProviderDetailFeedback.js";
import { ProviderTemplatePicker } from "@/settings/model-provider-section/ProviderTemplatePicker.js";
import type { ProviderSettingsView } from "@zcode/services";
import "@/styles.css";

const params = new URLSearchParams(location.search);
const templates: ProviderSettingsView["providerTemplates"] = [
  {
    templateId: "standard-anthropic-messages",
    templateNameMap: { "zh-CN": "Anthropic Messages", "en-US": "Anthropic Messages" },
    config: { api: { type: "anthropic-messages" } },
  },
  {
    templateId: "standard-openai-chat-completions",
    templateNameMap: { "zh-CN": "OpenAI Chat Completions", "en-US": "OpenAI Chat Completions" },
    config: { api: { type: "openai-chat-completions" } },
  },
  {
    templateId: "standard-openai-responses",
    templateNameMap: { "zh-CN": "OpenAI Responses", "en-US": "OpenAI Responses" },
    config: { api: { type: "openai-responses" } },
  },
];

document.documentElement.className =
  params.get("theme") === "light" ? "light theme-zai-light" : "dark theme-zai-dark";

function Fixture() {
  return (
    <main className="min-h-screen bg-background p-4 text-foreground">
      <ProviderTemplatePicker
        templates={templates}
        creating={false}
        onBack={() => undefined}
        onCreateFromTemplate={async (templateId) => {
          document.querySelector('[data-testid="created"]')?.setAttribute("value", templateId);
        }}
        onCreateCustom={async () => undefined}
      />
      <output data-testid="created" value="" />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <ZCodeIntlProvider initialLocale={params.get("locale") === "zh-CN" ? "zh-CN" : "en-US"}>
    <TooltipProvider>
      <ProviderDetailFeedbackBoundary>
        <Fixture />
      </ProviderDetailFeedbackBoundary>
    </TooltipProvider>
  </ZCodeIntlProvider>,
);
