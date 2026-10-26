// @vitest-environment jsdom
import { createElement, useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDefaultSystemPromptSettings,
  type SystemPromptCatalog,
  type SystemPromptSettings,
} from "@zcode/shared";
vi.mock("@/i18n/IntlProvider.js", () => ({
  useZCodeIntl: () => ({ intl: { formatMessage: ({ id }: { id: string }) => id } }),
}));
vi.mock("./hooks/useSystemPromptSettings.js", () => ({ useSystemPromptSettings: vi.fn() }));
import { SystemPromptEditor } from "./contract.js";

const catalog: SystemPromptCatalog = {
  version: 2,
  sections: [
    {
      id: "role",
      content: "DEFAULT_ROLE",
      generated: false,
      runtime: false,
      scenarios: [],
      injectionTarget: "system",
    },
    {
      id: "env_info",
      content: "",
      generated: true,
      runtime: false,
      scenarios: [],
      injectionTarget: "system",
    },
    {
      id: "desktop_context",
      content: "DESKTOP_RULE",
      generated: false,
      runtime: true,
      injectionTarget: "system",
      scenarios: [
        {
          id: "gen_ui_available",
          template: {
            available: true,
            defaultContent: "AVAILABLE\nDESKTOP_RULE",
            runtimeBefore: "AVAILABLE",
            runtimeAfter: "",
            variables: {},
          },
        },
        {
          id: "gen_ui_unavailable",
          template: {
            available: true,
            defaultContent: "UNAVAILABLE\nDESKTOP_RULE",
            runtimeBefore: "UNAVAILABLE",
            runtimeAfter: "",
            variables: {},
          },
        },
        {
          id: "terminal",
          template: {
            available: false,
            defaultContent: "",
            runtimeBefore: "",
            runtimeAfter: "",
            variables: {},
          },
        },
      ],
    },
  ],
};
const saved = (): SystemPromptSettings => ({
  ...createDefaultSystemPromptSettings(),
  sections: { role: { mode: "append", content: "SAVED_RULE", baseContent: "DEFAULT_ROLE" } },
});
afterEach(cleanup);

describe("system prompt editor", () => {
  it("默认原文折叠，生效预览保持完整；切章不沿用原文展开状态", () => {
    render(
      createElement(SystemPromptEditor, {
        catalog,
        settings: createDefaultSystemPromptSettings(),
        onSave: vi.fn(),
      }),
    );
    const source = screen.getByTestId("system-prompt-default-source") as HTMLDetailsElement;
    expect(source.open).toBe(false);
    expect(screen.getByTestId("system-prompt-preview").textContent).toBe("DEFAULT_ROLE");
    source.open = true;
    fireEvent.click(screen.getByTestId("system-prompt-chapter-desktop_context"));
    expect((screen.getByTestId("system-prompt-default-source") as HTMLDetailsElement).open).toBe(
      false,
    );
    expect(screen.getByTestId("system-prompt-preview").textContent).toContain("AVAILABLE");
  });

  it("keeps runtime facts visible when rules are disabled", () => {
    const settings = createDefaultSystemPromptSettings();
    settings.sections.desktop_context = { mode: "disabled", content: "" };
    render(createElement(SystemPromptEditor, { catalog, settings, onSave: vi.fn() }));
    fireEvent.click(screen.getByTestId("system-prompt-chapter-desktop_context"));
    expect(screen.getByTestId("system-prompt-preview").textContent).toBe("AVAILABLE");
    expect(screen.getByTestId("system-prompt-runtime").textContent).toBe("AVAILABLE");
    expect(screen.getByTestId("system-prompt-default").textContent).toBe("DESKTOP_RULE");
  });
  it("uses one dynamic context switch across both editing modes", () => {
    render(createElement(SystemPromptEditor, { catalog, settings: saved(), onSave: vi.fn() }));
    fireEvent.click(screen.getByTestId("system-prompt-mode-replace"));
    fireEvent.click(screen.getByTestId("system-prompt-context-env_info"));
    fireEvent.click(screen.getByTestId("system-prompt-mode-sections"));
    fireEvent.click(screen.getByTestId("system-prompt-chapter-env_info"));
    expect(screen.getByTestId("system-prompt-preview").textContent).toBe(
      "settings.systemPrompt.notInjected",
    );
    fireEvent.click(screen.getByTestId("system-prompt-mode-replace"));
    expect(screen.getByTestId("system-prompt-context-env_info").getAttribute("aria-checked")).toBe(
      "false",
    );
  });
  it("keeps edits local, previews them and discards without saving", () => {
    const save = vi.fn();
    render(createElement(SystemPromptEditor, { catalog, settings: saved(), onSave: save }));
    fireEvent.change(screen.getByTestId("system-prompt-chapter-content"), {
      target: { value: "DRAFT_RULE" },
    });
    expect(screen.getByTestId("system-prompt-preview").textContent).toContain("DRAFT_RULE");
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("settings.systemPrompt.discard"));
    expect((screen.getByTestId("system-prompt-chapter-content") as HTMLTextAreaElement).value).toBe(
      "SAVED_RULE",
    );
  });
  it("saves with the previous snapshot and preserves chapter edits across mode changes", async () => {
    const spy = vi.fn();
    function Harness() {
      const [settings, setSettings] = useState(saved());
      return createElement(SystemPromptEditor, {
        catalog,
        settings,
        onSave: async (next, previous) => {
          spy(next, previous);
          setSettings(next);
          return next;
        },
      });
    }
    render(createElement(Harness));
    fireEvent.change(screen.getByTestId("system-prompt-chapter-content"), {
      target: { value: "UPDATED_RULE" },
    });
    fireEvent.click(screen.getByTestId("system-prompt-mode-replace"));
    fireEvent.change(screen.getByTestId("system-prompt-replacement"), {
      target: { value: "WHOLE_REPLACEMENT" },
    });
    fireEvent.click(screen.getByTestId("system-prompt-save"));
    await waitFor(() => expect(spy).toHaveBeenCalledOnce());
    expect(spy.mock.calls[0]?.[0].sections.role.content).toBe("UPDATED_RULE");
    expect(spy.mock.calls[0]?.[1]).toEqual(saved());
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe("settings.systemPrompt.saved"),
    );
    fireEvent.click(screen.getByTestId("system-prompt-mode-sections"));
    expect((screen.getByTestId("system-prompt-chapter-content") as HTMLTextAreaElement).value).toBe(
      "UPDATED_RULE",
    );
  });
  it("retains edits after a failed save and allows a retry", async () => {
    const save = vi.fn().mockRejectedValue(new Error("offline"));
    render(createElement(SystemPromptEditor, { catalog, settings: saved(), onSave: save }));
    fireEvent.change(screen.getByTestId("system-prompt-chapter-content"), {
      target: { value: "RETRY_RULE" },
    });
    fireEvent.click(screen.getByTestId("system-prompt-save"));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("settings.systemPrompt.saveError"),
    );
    expect((screen.getByTestId("system-prompt-chapter-content") as HTMLTextAreaElement).value).toBe(
      "RETRY_RULE",
    );
    expect((screen.getByTestId("system-prompt-save") as HTMLButtonElement).disabled).toBe(false);
  });
  it("protects a dirty draft when another window publishes new settings", () => {
    const props = { catalog, settings: saved(), onSave: vi.fn() };
    const view = render(createElement(SystemPromptEditor, props));
    fireEvent.change(screen.getByTestId("system-prompt-chapter-content"), {
      target: { value: "LOCAL_DRAFT" },
    });
    view.rerender(
      createElement(SystemPromptEditor, {
        ...props,
        settings: createDefaultSystemPromptSettings(),
      }),
    );
    expect((screen.getByTestId("system-prompt-chapter-content") as HTMLTextAreaElement).value).toBe(
      "LOCAL_DRAFT",
    );
    expect((screen.getByTestId("system-prompt-save") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText("settings.systemPrompt.reload"));
    expect(screen.queryByTestId("system-prompt-chapter-content")).toBeNull();
  });
  it("shows changed defaults without replacing the user's content", () => {
    const settings = saved();
    settings.sections.role!.baseContent = "OLDER_DEFAULT";
    render(createElement(SystemPromptEditor, { catalog, settings, onSave: vi.fn() }));
    expect(screen.getByText("settings.systemPrompt.defaultsChanged")).toBeTruthy();
    expect(screen.getByText("OLDER_DEFAULT")).toBeTruthy();
    expect((screen.getByTestId("system-prompt-chapter-content") as HTMLTextAreaElement).value).toBe(
      "SAVED_RULE",
    );
  });
});
