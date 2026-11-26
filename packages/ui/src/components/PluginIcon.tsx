import { useState, type ReactNode } from "react";
import { Blocks } from "lucide-react";
import { cn } from "@/components/lib/utils.js";
import { resolvePluginIconSource } from "@/lib/pluginIconSource.js";

interface PluginIconProps {
  src?: string;
  pluginId?: string;
  className?: string;
  iconClassName?: string;
  fallbackIcon?: ReactNode;
}

export function PluginIcon({ src, pluginId, ...appearance }: PluginIconProps) {
  const primary = resolvePluginIconSource(pluginId, src);
  const bundled = resolvePluginIconSource(pluginId);
  // OZ-C014：HTTPS 地址有效也可能加载失败。按完整 ID 尝试随包素材，换来源时重新开始。
  const sources = primary ? [primary] : [];
  if (bundled && bundled !== primary) sources.push(bundled);
  return <PluginImage key={JSON.stringify([pluginId, src])} sources={sources} {...appearance} />;
}

function PluginImage({
  sources,
  className,
  iconClassName,
  fallbackIcon,
}: Pick<PluginIconProps, "className" | "iconClassName" | "fallbackIcon"> & {
  sources: string[];
}) {
  const [index, setIndex] = useState(0);
  const src = sources[index];
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 select-none items-center justify-center overflow-hidden rounded-xl bg-surface",
        !src && "text-foreground-subtle",
        className,
      )}
    >
      {src ? (
        <img
          key={src}
          src={src}
          alt=""
          draggable={false}
          className="size-full object-contain"
          onError={() => setIndex(index + 1)}
        />
      ) : fallbackIcon ? (
        fallbackIcon
      ) : (
        <Blocks className={cn("size-4", iconClassName)} />
      )}
    </span>
  );
}
