import type { WebRemoteControlConnectionSettings } from "@zcode/shared";
import { Input } from "@/components/ui/input.js";
import { Button } from "@/components/ui/button.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export function WebRemoteControlConnectionForm({
  value,
  onChange,
  disabled,
}: {
  value: WebRemoteControlConnectionSettings;
  onChange: (next: WebRemoteControlConnectionSettings) => void;
  disabled: boolean;
}) {
  const { intl } = useZCodeIntl();
  const text = (key: string) => intl.formatMessage({ id: `webRemoteControl.connection.${key}` });
  return (
    <fieldset
      disabled={disabled}
      data-testid="web-remote-connection-form"
      className="mb-4 min-w-0 space-y-3"
    >
      <legend className="mb-2 text-ui-base font-medium">{text("mode")}</legend>
      <div
        className="inline-flex max-w-full flex-wrap gap-0.5 rounded-lg border border-border p-0.5"
        role="group"
        aria-label={text("mode")}
      >
        {(["direct", "self-hosted", "official"] as const).map((mode) => (
          <Button
            key={mode}
            type="button"
            variant={value.mode === mode ? "secondary" : "ghost"}
            size="sm"
            aria-pressed={value.mode === mode}
            data-testid={`web-remote-mode-${mode}`}
            disabled={disabled}
            onClick={() => onChange({ ...value, mode })}
          >
            {text(mode)}
          </Button>
        ))}
      </div>
      {value.mode === "direct" ? (
        <>
          <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-3">
            <label className="space-y-1 text-ui-caption">
              {text("listenHost")}
              <Input
                data-testid="web-remote-listen-host"
                value={value.direct.listenHost}
                onChange={(event) =>
                  onChange({
                    ...value,
                    direct: { ...value.direct, listenHost: event.target.value },
                  })
                }
              />
            </label>
            <label className="space-y-1 text-ui-caption">
              {text("port")}
              <Input
                type="number"
                min={0}
                max={65535}
                data-testid="web-remote-listen-port"
                value={value.direct.port}
                onChange={(event) =>
                  onChange({
                    ...value,
                    direct: { ...value.direct, port: Number(event.target.value) },
                  })
                }
              />
            </label>
          </div>
          <label className="block space-y-1 text-ui-caption">
            {text("publicUrl")}
            <Input
              data-testid="web-remote-public-url"
              value={value.direct.publicUrl}
              placeholder="http://192.168.1.10:8080/remote/"
              onChange={(event) =>
                onChange({ ...value, direct: { ...value.direct, publicUrl: event.target.value } })
              }
            />
          </label>
          <p className="text-ui-caption text-foreground-subtle">{text("directHelp")}</p>
        </>
      ) : value.mode === "self-hosted" ? (
        <>
          <label className="block space-y-1 text-ui-caption">
            {text("relayUrl")}
            <Input
              data-testid="web-remote-relay-url"
              value={value.relay.wsUrl}
              placeholder="wss://relay.example.com/ws"
              onChange={(event) =>
                onChange({ ...value, relay: { ...value.relay, wsUrl: event.target.value } })
              }
            />
          </label>
          <label className="block space-y-1 text-ui-caption">
            {text("pageUrl")}
            <Input
              data-testid="web-remote-page-url"
              value={value.relay.pageUrl}
              placeholder="https://relay.example.com/remote/"
              onChange={(event) =>
                onChange({ ...value, relay: { ...value.relay, pageUrl: event.target.value } })
              }
            />
          </label>
        </>
      ) : (
        <p className="text-ui-caption text-foreground-subtle">{text("officialHelp")}</p>
      )}
    </fieldset>
  );
}
