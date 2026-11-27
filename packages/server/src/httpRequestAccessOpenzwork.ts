import { isIP } from "node:net";
import { hostname, networkInterfaces } from "node:os";

function hostnameKey(value: string): string {
  return value.toLowerCase().replace(/^\[|\]$/g, "");
}

function isLoopback(host: string): boolean {
  return host === "localhost" || host === "::1" || (isIP(host) === 4 && host.startsWith("127."));
}

/** OW-P054：原生客户端可以不带 Origin；浏览器应通过其实际访问的 Host 和端口进入。 */
export function createHttpRequestAccess(
  host: string,
  authenticated: boolean,
  allowUnauthenticatedLan: boolean,
) {
  const bound = hostnameKey(host);
  const loopback = isLoopback(bound);
  if (!loopback && !authenticated && !allowUnauthenticatedLan) {
    throw new Error(
      "Set ZCODE_SERVER_AUTH_TOKEN for LAN access, or use zcode --web --no-token explicitly.",
    );
  }
  const trusted = new Set([bound]);
  if (bound === "0.0.0.0" || bound === "::") {
    trusted.add(hostnameKey(hostname()));
    for (const group of Object.values(networkInterfaces())) {
      for (const address of group ?? []) trusted.add(hostnameKey(address.address));
    }
  }
  return (authority: string | undefined, origin: string | undefined, protocol: string): boolean => {
    if (!authority || /[\s/@\\?#,]/.test(authority)) return false;
    try {
      const target = new URL(protocol + "//" + authority);
      const name = hostnameKey(target.hostname);
      if (!authenticated && !isLoopback(name) && !trusted.has(name)) return false;
      return origin === undefined || origin === target.origin;
    } catch {
      return false;
    }
  };
}
