import { PackageIcon } from "lucide-react";
import { cn } from "@/components/lib/utils.js";

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
