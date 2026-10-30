// @vitest-environment jsdom
import { createElement } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { appUsageSessionsPageSchema } from "@zcode/shared";
import { ZCodeIntlProvider } from "@/i18n/IntlProvider.js";
import { SessionUsageView } from "./index.js";
afterEach(cleanup);
it("shows scope-wide totals, missing titles and previous/next pages", () => {
  const page = appUsageSessionsPageSchema.parse({
    range: "30d",
    timeZone: "UTC",
    source: "agent-db",
    generatedAt: 1,
    offset: 50,
    limit: 50,
    totalCount: 128,
    childSessionCount: 42,
    projects: [],
    totals: { mainTokens: 1000, subagentTokens: 500, totalTokens: 1500 },
    rows: [
      {
        sessionId: "session-12345678",
        title: null,
        mainTokens: 120,
        subagentTokens: 80,
        totalTokens: 200,
        requestCount: 3,
        childSessionCount: 1,
        membership: "not-in-task-list",
        projectId: null,
        projectName: null,
      },
    ],
  });
  const change = vi.fn();
  render(
    createElement(ZCodeIntlProvider, {
      initialLocale: "en-US",
      children: createElement(SessionUsageView, { page, allProjects: true, onPageChange: change }),
    }),
  );
  expect(screen.getByTestId("usage-session-table").textContent).toContain(
    "Untitled session · 12345678",
  );
  expect(screen.getByTestId("usage-session-table").textContent).toContain("No longer in task list");
  expect(screen.getByTestId("usage-session-totals").textContent).toContain("1,500");
  expect(screen.getByText("51–51 of 128")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(change).toHaveBeenLastCalledWith(100);
  fireEvent.click(screen.getByRole("button", { name: "Previous" }));
  expect(change).toHaveBeenLastCalledWith(0);
});
