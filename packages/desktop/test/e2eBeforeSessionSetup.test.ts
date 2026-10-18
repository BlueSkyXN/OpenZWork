          events.push("reset-started");
          finishReset = () => {
            events.push("reset-finished");
            resolve();
          };
        events.push("coding-plan-team");
        events.push("coding-plan-upgrade");
        events.push("upstream-http");
        events.push("plugin-cdn");


    expect(events).toEqual([
      "record-before-session",
      "configure-env",
      "coding-plan-team",
      "coding-plan-case-mode",
      "upstream-http",
      "coding-plan-upgrade",
      "plugin-cdn",
      "reset-started",
    ]);
    expect(configureCodingPlanTeamMockForSpecs).toHaveBeenCalledWith([
      "./test/e2e/example.test.ts",
    ]);
    expect(resetHome).toHaveBeenCalledWith(["./test/e2e/example.test.ts"]);

    finishReset?.();
    await setupPromise;

    expect(events.at(-2)).toBe("reset-finished");
    expect(events.at(-1)).toBe("setup-resolved");

  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (resetHome.mock.calls.length > 0) {
      return;
    }
    await Promise.resolve();
  }
  throw new Error("resetHome was not called");
