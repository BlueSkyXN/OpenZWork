import { describe, expect, it } from "vitest";
import {
  decodedBase64Length,
  planPluginUiDownload,
  resolvePluginUiDownloadFileName,
  sanitizePluginUiDownloadFileName,
} from "@/plugin-ui/domain/pluginUiDownloadFile.js";

describe("plugin ui download file naming", () => {
  it("replaces path separators and control characters without a lint-disabled regex", () => {
    // 逐字符清洗必须覆盖原 /[\\/\u0000-\u001f]/ 正则的全部字符集：
    // 反斜杠、正斜杠与 C0 控制字符（NUL、TAB、LF、CR、ESC）都替换为下划线。
    expect(sanitizePluginUiDownloadFileName("a\\b/c")).toBe("a_b_c");
    expect(sanitizePluginUiDownloadFileName("bad\u0000name")).toBe("bad_name");
    expect(sanitizePluginUiDownloadFileName("line\nbreak\ttab")).toBe("line_break_tab");
    expect(sanitizePluginUiDownloadFileName("carriage\rreturn")).toBe("carriage_return");
    expect(sanitizePluginUiDownloadFileName("escape\u001b[2J")).toBe("escape_[2J");
    expect(sanitizePluginUiDownloadFileName("clean-name.txt")).toBe("clean-name.txt");
  });

  it("strips leading dots and caps the basename at 120 characters", () => {
    expect(sanitizePluginUiDownloadFileName("..hidden")).toBe("hidden");
    expect(sanitizePluginUiDownloadFileName(".")).toBe("");
    expect(sanitizePluginUiDownloadFileName(`${"x".repeat(130)}.txt`)).toHaveLength(120);
  });

  it("keeps an explicit extension and only appends the mime fallback when missing", () => {
    expect(resolvePluginUiDownloadFileName({ name: "report.csv", mimeType: "text/plain" }, 0)).toBe(
      "report.csv",
    );
    expect(resolvePluginUiDownloadFileName({ name: "report", mimeType: "text/csv" }, 0)).toBe(
      "report.csv",
    );
    expect(resolvePluginUiDownloadFileName({ name: "no-mime" }, 0)).toBe("no-mime");
  });

  it("falls back to the last uri segment, then to a numbered default", () => {
    expect(resolvePluginUiDownloadFileName({ uri: "https://example.test/a/report.pdf?q=1" }, 2)).toBe(
      "report.pdf",
    );
    // 尾斜杠 uri 的最后非空段是 host；只有完全无名字可用时才落到 download-<序号>。
    expect(resolvePluginUiDownloadFileName({ uri: "https://example.test/" }, 4)).toBe(
      "example.test",
    );
    expect(resolvePluginUiDownloadFileName({}, 4)).toBe("download-5");
  });

  it("plans text, blob and uri sources from inline items and resource links", () => {
    expect(
      planPluginUiDownload(
        { type: "resource_link", uri: "ui://app/x.png", mimeType: "image/png" },
        0,
      ),
    ).toMatchObject({ source: { kind: "uri", uri: "ui://app/x.png" } });
    expect(
      planPluginUiDownload(
        { type: "resource", resource: { name: "notes", uri: "", mimeType: "text/plain", text: "hello" } },
        0,
      ),
    ).toMatchObject({ name: "notes.txt", source: { kind: "text", text: "hello" } });
    expect(
      planPluginUiDownload(
        { type: "resource", resource: { name: "blob.bin", uri: "", mimeType: undefined, blob: "AAAA" } },
        0,
      ),
    ).toMatchObject({ source: { kind: "blob", blob: "AAAA" } });
    expect(
      planPluginUiDownload(
        { type: "resource", resource: { name: "linked", uri: "ui://app/linked", mimeType: undefined } },
        0,
      ),
    ).toMatchObject({ source: { kind: "uri", uri: "ui://app/linked" } });
  });

  it("measures decoded base64 byte length without decoding", () => {
    expect(decodedBase64Length("")).toBe(0);
    expect(decodedBase64Length("AAAA")).toBe(3);
    expect(decodedBase64Length("AAA=")).toBe(2);
    expect(decodedBase64Length("AA==")).toBe(1);
    // 空白先剥掉再计长度："AA AA\n==" 紧凑后为 6 字符（A A A A = = 中空白去除后），
    // floor(6*3/4)-2 = 2；"AAA A " 紧凑为 4 字符，floor(4*3/4) = 3。
    expect(decodedBase64Length("AA AA\n==")).toBe(2);
    expect(decodedBase64Length("  AAA A ")).toBe(3);
  });
});
