import type { ITerminalService } from "@zcode/services";
import { describe, expect, it, vi } from "vitest";
import { createWindowHostTerminalOwners } from "../src/host/windowHostAttachmentRpcPolicy.js";

describe("window host terminal owners", () => {
  it("keeps multiple mobile access owners isolated", () => {
    const owners = createWindowHostTerminalOwners(vi.fn());
    const lanTerminal = {} as ITerminalService;
    const relayTerminal = {} as ITerminalService;
    owners.addOwner("lan");
    owners.addOwner("relay");

    const lanScope = owners.bind("lan", "local", lanTerminal);
    const relayScope = owners.bind("relay", "local", relayTerminal);
    expect(lanScope).toBe(owners.bind("lan", "local", lanTerminal));
    expect(relayScope).not.toBe(lanScope);

    owners.removeOwner("lan");
    expect(() => owners.bind("lan", "local", lanTerminal)).toThrow("Terminal owner has ended");
    expect(owners.bind("relay", "local", relayTerminal)).toBe(relayScope);
  });
});
