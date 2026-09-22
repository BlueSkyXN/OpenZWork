import { ChevronDown, Plus } from "lucide-react";
import type { CreateTaskRequest } from "@/app-shell/types.js";
import { Button } from "@/components/ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export function PluginAddMenu({
  onAddMarketplace,
  testId,
}: {
  /** 官方 plugin-creator 入口已随官方插件定义移除；保留 prop 兼容既有挂载点。 */
  onCreateTask?: (request?: CreateTaskRequest) => void;
  onAddMarketplace: () => void;
  testId: string;
}) {
  const { intl } = useZCodeIntl();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="default" data-testid={testId}>
          {intl.formatMessage({ id: "pluginCreator.add" })}
          <ChevronDown className="size-3.5" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" data-testid="plugin-add-menu">
        <DropdownMenuItem
          data-testid="plugin-store-add-source-menu-item"
          onSelect={onAddMarketplace}
        >
          <Plus className="size-4" aria-hidden="true" />
          {intl.formatMessage({ id: "pluginCreator.addMarketplace" })}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
