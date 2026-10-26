import { memo, useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import {
  DEFAULT_WEB_REMOTE_CONTROL_CONNECTION_SETTINGS,
  type WebRemoteControlConnectionSettings,
} from "@zcode/shared";
import { WebRemoteControlConnectionForm } from "./WebRemoteControlConnectionForm.js";
import type { BotProvider, WebRemoteControlStatus } from "@zcode/shared";
import {
  isSameWebRemoteControlTarget,
  isReusableWebRemoteControlSession,
  getStatusLabel,
  getStatusDetail,
  getStatusDotClassName,
  getWebRemoteControlStatusTagLabel,
  isSameWebRemoteControlStatus,
  getFailureDescription,
} from "@/web-remote-control/domain/presentation.js";
import {
  Bot as BotIcon,
  CopyIcon,
  LoaderCircle,
  RefreshCw,
  Smartphone,
  ChevronRight,
  Unplug,
} from "lucide-react";
import { BotsDialog } from "@/BotsDialog.js";
import { ProviderIcon } from "@/BotsDialog/shared.js";
import { Button } from "@/components/ui/button.js";
import { toast } from "@/components/ui/toast.js";
import { useConfirmDialog } from "@/hooks/useConfirmDialog.js";
import { SettingsBreadcrumbReporter } from "@/settings/SettingsHeaderBreadcrumb.js";
import { useResolvedRemoteWorkspaceSessionId } from "@/hooks/useResolvedRemoteWorkspaceSessionId.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import { getBotProviderRegionTagLabelId } from "@/botsUi.js";

type RemoteControlBotProvider = Extract<BotProvider, "weixin" | "feishu" | "lark" | "telegram">;

const REMOTE_CONTROL_BOT_ENTRIES: Array<{
  provider: RemoteControlBotProvider;
}> = [
  { provider: "weixin" },
  { provider: "feishu" },
  { provider: "lark" },
  { provider: "telegram" },
];

export const RemoteControlSettingsSection = memo(function RemoteControlSettingsSectionComponent({
  workspacePath,
  workspaceIdentity,
  remoteSessionId: preferredRemoteSessionId,
  remoteTarget,
  initialTaskId,
}: {
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  remoteTarget?: unknown;
  initialTaskId?: string;
}) {
  const platform = usePlatform();
  const remoteSessionId =
    useResolvedRemoteWorkspaceSessionId(
      workspacePath,
      preferredRemoteSessionId,
      workspaceIdentity,
      remoteTarget,
    ) ?? undefined;
  // 设置 tab 不承载工作区；远端始终传递 identity 和 resolver 的存活结果，不复用旧 session。
  const canStart = Boolean(workspacePath.trim());
  const confirmDialog = useConfirmDialog();
  const { intl } = useZCodeIntl();
  const [status, setStatus] = useState<WebRemoteControlStatus>({
    status: "idle",
  });
  const [loading, setLoading] = useState(true);
  const [connection, setConnection] = useState<WebRemoteControlConnectionSettings>(() =>
    structuredClone(DEFAULT_WEB_REMOTE_CONTROL_CONNECTION_SETTINGS),
  );
  const [operationError, setOperationError] = useState<string>();
  const running = ["starting", "running", "connecting", "active"].includes(status.status);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [botsPageOpen, setBotsPageOpen] = useState(false);
  const [botEntryProvider, setBotEntryProvider] = useState<RemoteControlBotProvider | null>(null);

  const statusLabel = useMemo(
    () => getStatusLabel(status, intl.formatMessage),
    [intl.formatMessage, status],
  );
  const statusDetail = useMemo(
    () => getStatusDetail(status, intl.formatMessage),
    [intl.formatMessage, status],
  );
  const failureDescription = useMemo(
    () => getFailureDescription(status.failure, intl.formatMessage),
    [intl.formatMessage, status.failure],
  );
  const statusTagLabel = useMemo(
    () => getWebRemoteControlStatusTagLabel(status, intl.formatMessage),
    [intl.formatMessage, status],
  );
  const statusDotClassName = getStatusDotClassName(status);

  useEffect(() => {
    let cancelled = false;

    const syncWebRemoteControlStatus = async () => {
      setLoading(true);

      try {
        const [nextStatus, savedConnection] = await Promise.all([
          platform.getWebRemoteControlStatus(),
          platform.getWebRemoteControlConnectionSettings?.(),
        ]);
        if (!cancelled) {
          setStatus(nextStatus);
          setConnection(
            nextStatus.connection ??
              savedConnection ??
              structuredClone(DEFAULT_WEB_REMOTE_CONTROL_CONNECTION_SETTINGS),
          );
          setOperationError(undefined);
          logger.info("[RemoteControlSettingsSection] Web 远程控制状态已同步", {
            workspacePath,
            workspaceIdentity: workspaceIdentity ?? "none",
            remoteSessionId: remoteSessionId ?? "none",
            initialTaskId: initialTaskId ?? "none",
            status: nextStatus.status,
            sessionId: nextStatus.sessionId ?? "none",
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!cancelled) {
          setStatus({
            status: "error",
            workspacePath,
            remoteSessionId,
            error: message,
          });
          toast(intl.formatMessage({ id: "webRemoteControl.startFailed" }, { error: message }));
        }
        logger.error("[RemoteControlSettingsSection] 启动 Web 远程控制失败", {
          workspacePath,
          workspaceIdentity: workspaceIdentity ?? "none",
          remoteSessionId: remoteSessionId ?? "none",
          initialTaskId: initialTaskId ?? "none",
          error: message,
        });
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void syncWebRemoteControlStatus();

    return () => {
      cancelled = true;
    };
  }, [intl, platform, remoteSessionId, workspaceIdentity, workspacePath, initialTaskId]);

  useEffect(() => {
    let cancelled = false;

    const pollWebRemoteControlStatus = async () => {
      try {
        const nextStatus = await platform.getWebRemoteControlStatus();
        if (cancelled) {
          return;
        }

        const shouldApplyStatus =
          isSameWebRemoteControlTarget(
            nextStatus,
            workspacePath,
            workspaceIdentity,
            remoteSessionId,
          ) ||
          isReusableWebRemoteControlSession(nextStatus) ||
          nextStatus.status === "idle" ||
          nextStatus.status === "error";
        if (!shouldApplyStatus) {
          return;
        }

        setStatus((currentStatus) =>
          isSameWebRemoteControlStatus(currentStatus, nextStatus) ? currentStatus : nextStatus,
        );
      } catch {
        // Bugfix: Web 远程控制的状态变化发生在 main / relay 侧，
        // 如果页面只在打开时同步一次，状态会长期停在“等待连接”。
        // 这里用轻量轮询补齐状态刷新；单次失败时静默忽略，避免打断用户操作。
      }
    };

    const intervalId = window.setInterval(() => {
      void pollWebRemoteControlStatus();
    }, 1000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [platform, remoteSessionId, workspaceIdentity, workspacePath]);

  useEffect(() => {
    if (!status.qrUrl) {
      setQrDataUrl(null);
      return;
    }

    let cancelled = false;
    setQrDataUrl(null);

    void QRCode.toDataURL(status.qrUrl, {
      margin: 1,
      width: 320,
    })
      .then((dataUrl: string) => {
        if (!cancelled) {
          setQrDataUrl(dataUrl);
        }
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        logger.error("[RemoteControlSettingsSection] 生成二维码失败", message);
      });

    return () => {
      cancelled = true;
    };
  }, [status.qrUrl]);

  const handleStart = async () => {
    if (!canStart || loading) return;
    setLoading(true);
    setOperationError(undefined);
    try {
      const result = await platform.startWebRemoteControl({
        workspacePath,
        workspaceIdentity,
        remoteSessionId,
        initialTaskId,
        connection,
      });
      if (result.status !== "cancelled") {
        setStatus(result);
        setConnection(result.connection ?? connection);
      }
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const handleCopyLink = async () => {
    if (!status.connectUrl) {
      return;
    }

    try {
      await navigator.clipboard.writeText(status.connectUrl);
      toast(intl.formatMessage({ id: "webRemoteControl.copyLink.copied" }));
      logger.info("[RemoteControlSettingsSection] 已复制 Web 远程控制链接", {
        workspacePath,
        remoteSessionId: remoteSessionId ?? "none",
        sessionId: status.sessionId ?? "none",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast(intl.formatMessage({ id: "webRemoteControl.copyLinkFailed" }, { error: message }));
      logger.error("[RemoteControlSettingsSection] 复制 Web 远程控制链接失败", message);
    }
  };

  const handleRefreshQr = async () => {
    // Bugfix: 刷新二维码会废弃之前复制或扫码得到的 sid/hash 链接。
    // 之前按钮和复制链接并排，误触会让已发出的手机链接立即失效；这里先用统一确认弹窗保护。
    const confirmed = await confirmDialog({
      title: intl.formatMessage({ id: "webRemoteControl.refreshQr.confirmTitle" }),
      description: intl.formatMessage({
        id: "webRemoteControl.refreshQr.confirmDescription",
      }),
      confirmLabel: intl.formatMessage({ id: "webRemoteControl.refreshQr" }),
    });
    if (!confirmed) {
      return;
    }

    setLoading(true);
    try {
      // 逐字段 fallback 会把本地运行目标与最近远端工作区的 identity/session 拼在一起。
      // 重新配对沿用 Main 返回的完整目标，不能因设置页的最近工作区变化而切换路由。
      const target = status.workspacePath
        ? {
            workspacePath: status.workspacePath,
            workspaceIdentity: status.workspaceIdentity,
            remoteSessionId: status.remoteSessionId,
            initialTaskId: status.initialTaskId,
          }
        : { workspacePath, workspaceIdentity, remoteSessionId, initialTaskId };
      const nextStatus = await platform.refreshWebRemoteControlPairing({ connection, ...target });
      if (nextStatus.status === "cancelled") {
        // 兼容可取消的平台实现：保持当前运行状态，不显示成功或失败反馈。
        return;
      }
      // Bugfix: 泄露后的旧二维码包含 sid/hash，单纯重新绘制图片只会更新时间戳。
      // 这里走平台层 reset，确保 main 清掉持久化配对材料后重新注册 relay 设备。
      setStatus(nextStatus);
      toast(intl.formatMessage({ id: "webRemoteControl.refreshQr.success" }));
      logger.info("[RemoteControlSettingsSection] 已刷新 Web 远程控制二维码", {
        workspacePath,
        workspaceIdentity: workspaceIdentity ?? "none",
        remoteSessionId: remoteSessionId ?? "none",
        initialTaskId: initialTaskId ?? "none",
        sessionId: nextStatus.sessionId ?? "none",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast(intl.formatMessage({ id: "webRemoteControl.refreshQr.failed" }, { error: message }));
      logger.error("[RemoteControlSettingsSection] 刷新 Web 远程控制二维码失败", {
        workspacePath,
        workspaceIdentity: workspaceIdentity ?? "none",
        remoteSessionId: remoteSessionId ?? "none",
        initialTaskId: initialTaskId ?? "none",
        error: message,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleStop = async () => {
    setLoading(true);
    try {
      await platform.stopWebRemoteControl();
      setStatus({ status: "idle" });
      setOperationError(undefined);
      toast(intl.formatMessage({ id: "webRemoteControl.stopSuccess" }));
      logger.info("[RemoteControlSettingsSection] 已关闭 Web 远程控制", {
        workspacePath,
        remoteSessionId: remoteSessionId ?? "none",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast(intl.formatMessage({ id: "webRemoteControl.stopFailed" }, { error: message }));
      logger.error("[RemoteControlSettingsSection] 关闭 Web 远程控制失败", message);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenBotEntry = (provider: RemoteControlBotProvider) => {
    setBotEntryProvider(provider);
    setBotsPageOpen(true);
    logger.info("[RemoteControlSettingsSection] 打开 Bot Channel 配置入口", {
      workspacePath,
      workspaceIdentity: workspaceIdentity ?? "none",
      provider,
    });
  };

  const handleOpenBotsPage = () => {
    setBotEntryProvider(null);
    setBotsPageOpen(true);
    logger.info("[RemoteControlSettingsSection] 打开 Bots 总配置入口", {
      workspacePath,
      workspaceIdentity: workspaceIdentity ?? "none",
    });
  };

  if (botsPageOpen) {
    return (
      <>
        <SettingsBreadcrumbReporter
          items={[{ label: intl.formatMessage({ id: "webRemoteControl.botChannel.title" }) }]}
          onSectionSelect={() => setBotsPageOpen(false)}
        />
        <BotsDialog open embedded onOpenChange={setBotsPageOpen} entryProvider={botEntryProvider} />
      </>
    );
  }

  return (
    <div data-testid="remote-control-settings" className="min-w-0">
      <div
        data-testid="web-remote-control-main-grid"
        className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]"
      >
        <section
          data-testid="web-remote-control-scan-card"
          className="flex min-w-0 flex-col rounded-xl border border-card-border bg-card p-4"
        >
          <div className="mb-4 flex items-start gap-2">
            <Smartphone className="mt-0.5 size-4 shrink-0 text-foreground-subtle" />
            <div className="min-w-0 space-y-1">
              <h3 className="text-ui-base font-medium text-foreground">
                {intl.formatMessage({
                  id: "webRemoteControl.mobileQr.title",
                })}
              </h3>
              <p className="text-ui-sm/relaxed text-foreground-subtle">
                {intl.formatMessage({
                  id: "webRemoteControl.mobileQr.description",
                })}
              </p>
            </div>
          </div>
          {running ? (
            <p className="mb-3 text-ui-caption text-foreground-subtle">
              {intl.formatMessage({ id: "webRemoteControl.connection.mode" })}:{" "}
              {intl.formatMessage({ id: `webRemoteControl.connection.${connection.mode}` })}
            </p>
          ) : (
            <WebRemoteControlConnectionForm
              value={connection}
              onChange={setConnection}
              disabled={loading}
            />
          )}
          {!running ? (
            <Button
              type="button"
              data-testid="web-remote-start"
              className="mb-3 w-full self-end sm:w-auto"
              disabled={loading || !canStart}
              onClick={() => void handleStart()}
            >
              {intl.formatMessage({ id: "webRemoteControl.connection.start" })}
            </Button>
          ) : null}
          {!canStart && !running ? (
            <p className="mb-3 text-ui-sm text-foreground-subtle">
              {intl.formatMessage({
                id: "webRemoteControl.connection.workspaceRequired",
              })}
            </p>
          ) : null}
          {operationError ? (
            <p role="alert" className="mb-3 text-ui-base text-destructive">
              {operationError}
            </p>
          ) : null}
          {status.status !== "idle" ? (
            <div
              data-testid="web-remote-control-connection-card"
              className="mb-3 rounded-lg bg-surface px-3 py-2"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="text-ui-base font-medium text-foreground">{statusLabel}</div>
                    <div className="flex min-w-0 items-center gap-1.5 rounded-full bg-card px-2 py-0.5 text-ui-xs font-medium text-foreground-subtle">
                      <span className={`size-1.5 shrink-0 rounded-full ${statusDotClassName}`} />
                      <span className="truncate">{statusTagLabel}</span>
                    </div>
                  </div>
                  <div className="text-ui-base/relaxed text-foreground-subtle">{statusDetail}</div>
                </div>
                {loading ? (
                  <LoaderCircle className="size-4 animate-spin text-foreground-subtle" />
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="default"
                    className="shrink-0 gap-2 enabled:cursor-pointer"
                    onClick={() => void handleStop()}
                  >
                    <Unplug className="size-3.5" />
                    {intl.formatMessage({ id: "webRemoteControl.stop" })}
                  </Button>
                )}
              </div>
              {failureDescription ? (
                <div className="mt-3 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-ui-base/relaxed text-destructive">
                  <p>{failureDescription}</p>
                  {status.failure?.message && status.failure.message !== failureDescription ? (
                    <p className="mt-1 text-ui-xs/relaxed opacity-80">{status.failure.message}</p>
                  ) : null}
                </div>
              ) : status.error ? (
                <p className="mt-3 text-ui-base/relaxed text-destructive">{status.error}</p>
              ) : null}
              {running ? (
                <div
                  data-testid="web-remote-control-copy-link-row"
                  className="mt-3 flex min-h-10 flex-wrap items-center gap-3 border-t border-border pt-3"
                >
                  <div className="min-w-48 flex-1 text-ui-base/relaxed text-foreground-subtle">
                    {intl.formatMessage({
                      id: "webRemoteControl.copyLink.description",
                    })}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="default"
                    className="shrink-0 gap-2 enabled:cursor-pointer"
                    onClick={() => void handleRefreshQr()}
                    disabled={loading || !running}
                  >
                    <RefreshCw className="size-3.5" />
                    {intl.formatMessage({ id: "webRemoteControl.refreshQr" })}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="default"
                    className="shrink-0 gap-2 enabled:cursor-pointer"
                    onClick={() => void handleCopyLink()}
                    disabled={!status.connectUrl || loading}
                  >
                    <CopyIcon className="size-3.5" />
                    {intl.formatMessage({ id: "webRemoteControl.copyLink" })}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
          {running ? (
            <div
              data-testid="web-remote-control-qr"
              className="flex items-center justify-center rounded-lg border border-border bg-background-alt p-4"
            >
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt={intl.formatMessage({ id: "webRemoteControl.qrAlt" })}
                  className="size-64 max-w-full rounded-lg bg-white p-3"
                />
              ) : (
                <div className="flex flex-col items-center gap-3 text-center text-ui-base text-foreground-subtle">
                  {loading ? (
                    <LoaderCircle className="size-5 animate-spin" />
                  ) : (
                    <Smartphone className="size-5" />
                  )}
                  <span>
                    {intl.formatMessage({
                      id: loading
                        ? "webRemoteControl.generating"
                        : "webRemoteControl.connection.ready",
                    })}
                  </span>
                </div>
              )}
            </div>
          ) : null}
        </section>

        <section className="flex min-w-0 flex-col rounded-xl border border-card-border bg-card p-4">
          <div className="mb-4 flex items-start gap-2">
            <BotIcon className="mt-0.5 size-4 shrink-0 text-foreground-subtle" />
            <div className="min-w-0 space-y-1">
              <h3 className="text-ui-base font-medium text-foreground">
                {intl.formatMessage({
                  id: "webRemoteControl.botChannel.title",
                })}
              </h3>
              <p className="text-ui-sm/relaxed text-foreground-subtle">
                {intl.formatMessage({
                  id: "webRemoteControl.botChannel.description",
                })}
              </p>
            </div>
          </div>
          <div className="grid divide-y divide-border">
            {REMOTE_CONTROL_BOT_ENTRIES.map((entry) => {
              const regionTagLabelId = getBotProviderRegionTagLabelId(entry.provider);

              return (
                <button
                  key={entry.provider}
                  data-testid={`web-remote-bot-${entry.provider}`}
                  type="button"
                  className="flex min-w-0 cursor-pointer items-center gap-3 rounded-md px-2 py-3 text-left transition-colors hover:bg-surface-hover"
                  onClick={() => handleOpenBotEntry(entry.provider)}
                >
                  {/* Bugfix: 远控 Bot Channel 入口原来用通用 lucide 图标，用户无法一眼区分微信、飞书和 Telegram。
                            这里直接复用 BotsDialog 的渠道 logo，不再额外包裹容器，保证品牌图标本身作为视觉识别。 */}
                  <ProviderIcon provider={entry.provider} className="size-6 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-1.5 text-ui-base font-medium text-foreground">
                      <span className="min-w-0 truncate">
                        {intl.formatMessage({
                          id: `webRemoteControl.botChannel.${entry.provider}.title`,
                        })}
                      </span>
                      {regionTagLabelId ? (
                        <span className="inline-flex h-5 shrink-0 items-center rounded-full border border-border px-2 text-ui-xs font-medium leading-none text-foreground-subtle">
                          {intl.formatMessage({ id: regionTagLabelId })}
                        </span>
                      ) : null}
                    </span>
                    <span className="sr-only">
                      {intl.formatMessage({
                        id: `webRemoteControl.botChannel.${entry.provider}.description`,
                      })}
                    </span>
                  </span>
                  <span className="shrink-0 text-ui-base text-foreground-subtle">
                    {intl.formatMessage({
                      id: "webRemoteControl.botChannel.configure",
                    })}
                  </span>
                  <ChevronRight className="size-3.5 shrink-0 text-foreground-subtle" />
                </button>
              );
            })}
          </div>
          <div className="mt-3">
            <Button
              type="button"
              variant="outline"
              size="default"
              data-testid="web-remote-control-open-bots"
              className="justify-start gap-2 enabled:cursor-pointer"
              onClick={handleOpenBotsPage}
            >
              <BotIcon className="size-3.5" />
              {intl.formatMessage({
                id: "webRemoteControl.botChannel.manageBots",
              })}
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
});
