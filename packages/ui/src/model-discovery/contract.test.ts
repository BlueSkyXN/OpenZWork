// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ZCodeIntlProvider } from "@/i18n/IntlProvider.js";
import { ProviderModelDiscoveryDialog } from "./index.js";
import type { ProviderModelDiscoveryDialogProps } from "./contract.js";
const state = vi.hoisted(() => ({
  result: {
    ok: true,
    models: [
      { modelId: "existing", configComplete: true },
      { modelId: "ready", configComplete: true },
      { modelId: "retry", configComplete: true },
      { modelId: "unknown", configComplete: false },
    ],
    truncated: false,
  },
  resolve: vi.fn(async () => ({ effectiveConfig: {}, inheritedConfig: {}, issues: [] })),
}));
vi.mock("@/hooks/useProviderModelDiscovery.js", () => ({
  useProviderModelDiscovery: () => ({
    loading: false,
    result: state.result,
    resolve: state.resolve,
    refresh: vi.fn(),
  }),
}));
afterEach(cleanup);
it("existing models stay disabled, missing config uses the editor, partial saves retain retry", async () => {
  const add = vi.fn(async (model: { modelId: string }) => {
    if (model.modelId === "retry") throw new Error("failed");
  });
  const configure = vi.fn(),
    close = vi.fn();
  const props: ProviderModelDiscoveryDialogProps = {
    providerId: "p",
    open: true,
    models: [
      {
        kind: "candidate",
        modelId: "existing",
        builtin: false,
        personalConfig: {},
        config: {},
        hasPersonalConfig: false,
        executable: true,
        selectable: true,
      },
    ],
    onOpenChange: close,
    onAddModel: add,
    onConfigure: configure,
  };
  render(
    createElement(ZCodeIntlProvider, {
      initialLocale: "en-US",
      children: createElement(ProviderModelDiscoveryDialog, props),
    }),
  );
  expect(
    screen.getByRole("checkbox", { name: "existing" }).getAttribute("data-disabled"),
  ).not.toBeNull();
  fireEvent.click(screen.getByRole("checkbox", { name: "ready" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "retry" }));
  fireEvent.click(screen.getByTestId("provider-model-discovery-add"));
  await waitFor(() => expect(add).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(screen.getByTestId("provider-model-discovery-add").textContent).toContain("1"),
  );
  expect(close).not.toHaveBeenCalled();
  expect(
    screen.getByRole("checkbox", { name: "ready" }).getAttribute("data-disabled"),
  ).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Configure" }));
  expect(configure).toHaveBeenCalledWith("unknown");
  expect(close).toHaveBeenCalledWith(false);
});
