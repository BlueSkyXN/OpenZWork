
  it("returns null for malformed state", () => {
    expect(parseOAuthState("not-json")).toBeNull();
    expect(parseOAuthState(buildOAuthState({ nonce: "" }))).toBeNull();

  it("only trusts private development callback urls", () => {
    expect(isTrustedDevReturnTo(new URL("http://192.168.1.8:5173/web-remote/callback"))).toBe(true);
    expect(isTrustedDevReturnTo(new URL("http://172.31.2.3:5173/web-remote/callback"))).toBe(true);
    expect(isTrustedDevReturnTo(new URL("http://127.0.0.1:5173/cn/share/callback"))).toBe(true);
    expect(isTrustedDevReturnTo(new URL("http://127.0.0.1:5173/share/callback"))).toBe(true);
    expect(isTrustedDevReturnTo(new URL("http://172.32.2.3:5173/web-remote/callback"))).toBe(false);
    expect(isTrustedDevReturnTo(new URL("https://example.com/web-remote/callback"))).toBe(false);
    expect(isTrustedDevReturnTo(new URL("http://127.0.0.1:5173/other"))).toBe(false);
  });

  it("sanitizes app_return_to to same-origin web-remote paths and allowed query keys", () => {
    expect(
      resolveSafeAppReturnTo(
      ),
    ).toBe("/web-remote?remoteControlToken=token&relayOrigin=https%3A%2F%2Frelay.example");

    expect(
      resolveSafeAppReturnTo("https://evil.example/web-remote?remoteControlToken=token", {
      }),
    ).toBeNull();

    expect(
      resolveSafeAppReturnTo("http://192.168.1.8:5173/web-remote?remoteControlToken=token", {
        currentOrigin: "http://192.168.1.8:5173",
      }),
    ).toBe("/web-remote?remoteControlToken=token");
  });

  it("accepts a same-origin share route as a safe OAuth return target", () => {
    expect(
    ).toBe("/cn/share/share-1");
    expect(
    ).toBe("/share/share-1");
    expect(
      resolveSafeAppReturnTo("https://evil.example/cn/share/share-1", {
      }),
    ).toBeNull();
  });

  it("builds a sanitized return_to callback URL for dev redirects", () => {
    expect(
      buildReturnToCallbackUrl("http://192.168.1.8:5173/web-remote/callback?old=1", {
        code: "code-1",
        state: "state-1",
      }),
    ).toBe("http://192.168.1.8:5173/web-remote/callback?code=code-1&state=state-1");

    expect(
      buildReturnToCallbackUrl("http://127.0.0.1:5173/share/callback", {
        code: "code-1",
        state: "state-1",
      }),
    ).toBe("http://127.0.0.1:5173/share/callback?code=code-1&state=state-1");

    expect(
      buildReturnToCallbackUrl("https://example.com/web-remote/callback", {
        error: "access_denied",
        state: "state-1",
      }),
    ).toBeNull();
  });
});
