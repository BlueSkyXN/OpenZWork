import { PackageIcon } from "lucide-react";
import { cn } from "@/components/lib/utils.js";
// 净化保留：上游内置厂商 logo 目录（含 start-plan/zai-app 等官方套餐素材）已随
// aa7860b0「仅保留三种标准协议模板」整体移除，本文件继续用通用 PackageIcon 兜底。

export function ProviderLogo({
  logo,
  className,
}: {
  // 旧个人配置可能仍保存 logo key；标准内置目录不再携带厂商素材。
  logo?: unknown;
  className?: string;
}) {
  void logo;
  return <PackageIcon className={cn("shrink-0", className)} aria-hidden="true" />;
}
