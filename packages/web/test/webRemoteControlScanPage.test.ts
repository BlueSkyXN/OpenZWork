// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WebRemoteControlScanPage } from "../src/web-remote-control/views.js";
afterEach(cleanup);

it("accepts a complete V1 pairing link from the bare HTTP entry", () => {
  const onConnect = vi.fn();
  const view = render(createElement(WebRemoteControlScanPage, { locale: "zh-CN", onConnect }));
  fireEvent.change(view.getByRole("textbox"), {
    target: { value: "http://phone.example/remote/?sid=synthetic&hash=synthetic&t=1" },
  });
  fireEvent.click(view.getByRole("button", { name: "连接" }));
  expect(onConnect).toHaveBeenCalledOnce();
  expect(onConnect.mock.calls[0]![0].get("sid")).toBe("synthetic");
});

it.each([
  "javascript:alert(1)",
  "http://phone.example/remote/",
  "http://phone.example/?sid=x&hash=y&t=1&relay=javascript:bad",
])("rejects an invalid link without connecting: %s", (value) => {
  const onConnect = vi.fn();
  const view = render(createElement(WebRemoteControlScanPage, { locale: "en-US", onConnect }));
  fireEvent.change(view.getByRole("textbox"), { target: { value } });
  fireEvent.click(view.getByRole("button", { name: "Connect" }));
  expect(onConnect).not.toHaveBeenCalled();
  expect(view.getByRole("alert").textContent).toContain("complete link");
});
