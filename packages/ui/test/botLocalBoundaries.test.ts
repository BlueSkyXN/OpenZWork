import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("new bots start disabled and channel registration runs only from explicit UI actions", async () => {
  // Windows CI 的 git autocrlf 检出为 CRLF；本测试对源码做字面 "\n" 定位，
  // 先按仓库既有惯例（skillsService frontmatter 解析同款）归一为 LF 再断言。
  const readSource = async (url: URL): Promise<string> =>
    (await readFile(url, "utf8")).replace(/\r\n|\r/g, "\n");
  const source = await readSource(new URL("../src/BotsDialog.tsx", import.meta.url));
  const providerCard = await readSource(
    new URL("../src/BotsDialog/ProviderSettingsCard.tsx", import.meta.url),
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
