import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("new bots start disabled and channel registration runs only from explicit UI actions", async () => {
  const source = await readFile(new URL("../src/BotsDialog.tsx", import.meta.url), "utf8");
  const providerCard = await readFile(
    new URL("../src/BotsDialog/ProviderSettingsCard.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /provider:\s*params\.provider,[\s\S]{0,100}enabled:\s*false/u);
  assert.match(
    providerCard,
    /onClick=\{isWeixin \? onStartWeixinRegistration : onStartFeishuRegistration\}/u,
  );
  assert.match(
    source,
    /onStartWeixinRegistration=\{\(\) =>[\s\S]*?void handleStartWeixinRegistration\(\)\s*\}/u,
  );
  assert.match(
    source,
    /onStartFeishuRegistration=\{\(\) =>[\s\S]*?void handleStartFeishuRegistration\(\)\s*\}/u,
  );

  const registrationEffectStart = source.indexOf(
    "  useEffect(() => {\n    if (!open || creatingBot || !selectedBot)",
  );
  assert.notEqual(registrationEffectStart, -1);
  const registrationEffectEnd = source.indexOf("\n  }, [", registrationEffectStart);
  assert.notEqual(registrationEffectEnd, -1);
  const registrationEffect = source.slice(registrationEffectStart, registrationEffectEnd);
  assert.doesNotMatch(registrationEffect, /handleStart(?:Feishu|Weixin)Registration\s*\(/u);
});
