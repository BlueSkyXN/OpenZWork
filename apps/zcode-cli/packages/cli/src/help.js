import { getZCodeCopy } from "@zcode/i18n";
export function formatCliHelp(version, locale, detectedLocale) {
    return getZCodeCopy(locale, detectedLocale).cli.help(version);
}
