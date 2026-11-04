import { Plus, Trash2 } from "lucide-react";
import type { WebRemoteControlConnectionSettings, WebRemoteControlStatus } from "@zcode/shared";
import { getWebRemoteControlProfileId } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { getStatusDotClassName } from "@/web-remote-control/domain/presentation.js";

export function WebRemoteControlProfileList({
  profiles,
  statusesById,
  selectedProfileId,
  runningProfileIds,
  loading,
  onSelect,
  onAdd,
  onDelete,
}: {
  profiles: WebRemoteControlConnectionSettings[];
  statusesById: Record<string, WebRemoteControlStatus>;
  selectedProfileId: string;
  runningProfileIds: Set<string>;
  loading: boolean;
  onSelect: (profileId: string) => void;
  onAdd: () => void;
  onDelete: (profileId: string) => void;
}) {
  const { intl } = useZCodeIntl();

  return (
    <div data-testid="web-remote-profile-list" className="mb-4 min-w-0 space-y-2">
      <div className="flex min-h-8 items-center justify-between gap-2">
        <span className="text-ui-caption font-medium text-foreground-subtle">
          {intl.formatMessage({ id: "webRemoteControl.connection.profiles" })}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="web-remote-add-profile"
          className="gap-1.5"
          disabled={loading}
          onClick={onAdd}
        >
          <Plus className="size-3.5" />
          {intl.formatMessage({ id: "webRemoteControl.connection.addProfile" })}
        </Button>
      </div>
      <div className="grid gap-1.5">
        {profiles.map((profile) => {
          const profileId = getWebRemoteControlProfileId(profile);
          const profileStatus = statusesById[profileId];
          const label =
            profile.name?.trim() ||
            intl.formatMessage({ id: `webRemoteControl.connection.${profile.mode}` });
          return (
            <div key={profileId} className="flex min-w-0 items-center gap-1.5">
              <Button
                type="button"
                variant={profileId === selectedProfileId ? "secondary" : "ghost"}
                size="sm"
                data-testid={`web-remote-profile-${profileId}`}
                aria-pressed={profileId === selectedProfileId}
                className="min-w-0 flex-1 justify-start gap-2"
                onClick={() => onSelect(profileId)}
              >
                <span
                  className={`size-1.5 shrink-0 rounded-full ${getStatusDotClassName(profileStatus ?? { status: "idle" })}`}
                />
                <span className="min-w-0 flex-1 truncate text-left">{label}</span>
                <span className="shrink-0 text-ui-xs text-foreground-subtle">
                  {intl.formatMessage({ id: `webRemoteControl.connection.${profile.mode}` })}
                </span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                data-testid={`web-remote-delete-profile-${profileId}`}
                aria-label={intl.formatMessage(
                  { id: "webRemoteControl.connection.deleteProfile" },
                  { name: label },
                )}
                disabled={loading || profiles.length <= 1 || runningProfileIds.has(profileId)}
                className="shrink-0"
                onClick={() => onDelete(profileId)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
