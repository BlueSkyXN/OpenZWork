import assert from "node:assert/strict";
import test from "node:test";
import {
  shouldShowOccupationOnboarding,
  shouldWaitForOccupationOnboardingSettings,
} from "../src/onboarding/onboardingVisibility.ts";

test("first-run onboarding reads only local settings and a local dismissal bit", () => {
  assert.equal(
    shouldShowOccupationOnboarding({
      requested: false,
      hasStoredOccupation: false,
      dismissed: false,
      closedThisSession: false,
    }),
    true,
  );
  assert.equal(
    shouldShowOccupationOnboarding({
      requested: false,
      hasStoredOccupation: true,
      dismissed: false,
      closedThisSession: false,
    }),
    false,
  );
  assert.equal(
    shouldShowOccupationOnboarding({
      requested: false,
      hasStoredOccupation: false,
      dismissed: true,
      closedThisSession: false,
    }),
    false,
  );
  assert.equal(
    shouldShowOccupationOnboarding({
      requested: true,
      hasStoredOccupation: true,
      dismissed: true,
      closedThisSession: false,
    }),
    true,
  );
  assert.equal(
    shouldShowOccupationOnboarding({
      requested: false,
      hasStoredOccupation: false,
      dismissed: false,
      closedThisSession: true,
    }),
    false,
  );
});

test("startup waits for AppSettings only when no explicit onboarding request exists", () => {
  assert.equal(
    shouldWaitForOccupationOnboardingSettings({ settingsLoaded: false, requested: false }),
    true,
  );
  assert.equal(
    shouldWaitForOccupationOnboardingSettings({ settingsLoaded: false, requested: true }),
    false,
  );
  assert.equal(
    shouldWaitForOccupationOnboardingSettings({ settingsLoaded: true, requested: false }),
    false,
  );
});
