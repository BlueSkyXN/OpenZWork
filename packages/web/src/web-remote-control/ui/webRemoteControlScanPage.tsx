import { WebRemoteControlBrand } from "#src/web-remote-control/ui/webRemoteControlBrand.js";
import { useState } from "react";
import { Button } from "@zcode/ui/button";
import { parseWebRemoteControlExternalQrParams } from "@zcode/shared";

export function WebRemoteControlScanPage({
  locale,
  onConnect,
}: {
  locale: "zh-CN" | "en-US";
  onConnect?: (params: URLSearchParams) => void;
}) {
  const zh = locale === "zh-CN";
  const [link, setLink] = useState("");
  const [error, setError] = useState(false);
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-8 text-foreground">
      <section className="w-full max-w-sm rounded-xl border border-card-border bg-card p-5 shadow-sm">
        <WebRemoteControlBrand className="mb-2" />
        <h1 className="text-ui-lg font-medium">
          {zh ? "请扫描桌面二维码" : "Scan the desktop QR code"}
        </h1>
        <p className="mt-2 text-ui-xs leading-6 text-foreground-subtle">
          {zh
            ? "在电脑端开启远程控制，扫描二维码或粘贴连接链接。"
            : "Start remote control on your computer, then scan the QR code or paste its connection link."}
        </p>
        {onConnect ? (
          <form
            className="mt-4 space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              try {
                const url = new URL(link.trim());
                if (
                  !["http:", "https:"].includes(url.protocol) ||
                  !parseWebRemoteControlExternalQrParams(url.searchParams)
                )
                  throw new Error("Invalid link");
                onConnect(url.searchParams);
              } catch {
                setError(true);
              }
            }}
          >
            <label className="block space-y-1 text-ui-caption">
              {zh ? "桌面连接链接" : "Desktop connection link"}
              <textarea
                className="w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-mobile-input-safe outline-none focus-visible:ring-2 focus-visible:ring-ring"
                rows={3}
                value={link}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => {
                  setLink(event.target.value);
                  setError(false);
                }}
              />
            </label>
            {error ? (
              <p role="alert" className="text-ui-caption text-destructive">
                {zh
                  ? "请粘贴桌面远程控制面板复制的完整链接。"
                  : "Paste the complete link copied from the desktop remote control panel."}
              </p>
            ) : null}
            <Button className="w-full" type="submit" disabled={!link.trim()}>
              {zh ? "连接" : "Connect"}
            </Button>
          </form>
        ) : null}
      </section>
    </main>
  );
}
