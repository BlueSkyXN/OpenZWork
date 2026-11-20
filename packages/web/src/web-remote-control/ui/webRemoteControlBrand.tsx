import { OPENZWORK_APP_NAME } from "@zcode/shared";
import { ZCodeAppLogo } from "@zcode/ui/app-logo";

/** 连接前各页的页头品牌：桌面端同款 logo 图标 与产品显示名，纯静态标识，不可点击。 */
export function WebRemoteControlBrand({ className }: { className?: string }) {
  return (
    <span className={["inline-flex items-center gap-2", className].filter(Boolean).join(" ")}>
      <ZCodeAppLogo className="size-5" />
      <span className="text-ui-xs font-medium">{OPENZWORK_APP_NAME}</span>
    </span>
  );
}
