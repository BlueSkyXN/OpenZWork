import { validateWebRemoteControlUrl } from "../contract.js";

export function resolveWebRemoteControlBrowserRelayUrl(origin: string, override?: string): string {
  const page = new URL(origin);
  const url = new URL(override ? validateWebRemoteControlUrl(override, "relay") : "/ws", page);
  if (!override) url.protocol = page.protocol === "https:" ? "wss:" : "ws:";
  if (page.protocol === "https:" && url.protocol !== "wss:") {
    throw new Error("HTTPS 手机页面需要 WSS relay 地址");
  }
  return url.toString();
}

export function resolveWebRemoteControlRoutePathFromBaseUrl(baseUrl: string): string {
  const rawBaseUrl = baseUrl.trim() || "/";
  let pathname = "/";

  try {
    pathname = new URL(rawBaseUrl, "https://zcode.invalid").pathname;
  } catch {
    pathname = rawBaseUrl.startsWith("/") ? rawBaseUrl : `/${rawBaseUrl}`;
  }

  const normalizedPathname = pathname.replace(/\/+$/, "") || "/";
  if (normalizedPathname === "/") {
    return "/remote";
  }
  return normalizedPathname;
}

export function matchesWebRemoteControlRoutePath(pathname: string, routePath: string): boolean {
  // Bugfix: dev / production 入口可能带 /remote/ 尾斜杠；
  // 路由判断需要接受 /remote 与 /remote/，但不能把 /remote/favicon.ico 当成应用入口。
  const normalizeRoutePath = (value: string) => value.replace(/\/+$/, "") || "/";
  return normalizeRoutePath(pathname) === normalizeRoutePath(routePath);
}
