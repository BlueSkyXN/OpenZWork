import { z } from "zod";
import { getCommunityUrlFromConfigs, getFeedbackUrlFromConfig } from "./remoteAppConfig.js";

const helpConfigSchema = z.object({
  community_urls: z
    .object({
      "zh-CN": z.string().optional().catch(undefined),
      "en-US": z.string().optional().catch(undefined),
    })
    .optional()
    .catch(undefined),
  feedback_url: z.string().optional().catch(undefined),
  feedback_use_external_form: z.boolean().optional().catch(undefined),
});
export type HelpAppConfig = z.infer<typeof helpConfigSchema>;

// 官方 /api/v1/client/configs 远端拉取已随官方服务移除：帮助配置只走本地打包默认值
// （desktop 读 resources/config/default.json，web 读构建期 config/default.json）。
export function resolveHelpAppConfig(local: unknown): HelpAppConfig {
  const localConfig = helpConfigSchema.safeParse(local).data;
  return {
    community_urls: {
      "zh-CN": getCommunityUrlFromConfigs(undefined, localConfig, "zh-CN"),
      "en-US": getCommunityUrlFromConfigs(undefined, localConfig, "en-US"),
    },
    feedback_url: getFeedbackUrlFromConfig(localConfig),
    feedback_use_external_form: localConfig?.feedback_use_external_form ?? false,
  };
}
