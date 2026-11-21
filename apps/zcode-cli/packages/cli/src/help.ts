import { getZCodeCopy, type SupportedLocale, type UiLocale } from "@zcode/i18n";
import { OPENZWORK_APP_NAME } from "@zcode/shared";

export function formatCliHelp(
  version: string,
  locale?: UiLocale,
  detectedLocale?: SupportedLocale,
  distributionVersion?: string,
): string {
  const copy = getZCodeCopy(locale, detectedLocale);
  const help = copy.cli.help(version, OPENZWORK_APP_NAME, distributionVersion);
  return help + "\n" + copy.cli.providerConfigGuide + "\n  https://github.com/BlueSkyXN/OpenZWork/blob/main/apps/zcode-cli/docs/usage/03-config.md\n";
}
