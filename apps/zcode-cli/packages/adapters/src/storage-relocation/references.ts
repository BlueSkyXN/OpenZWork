import { relocateFileReference, type DataRelocationPlan } from "@zcode/shared/data-directory";

type RecordValue = Record<string, unknown>;
export function record(value: unknown): RecordValue | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : undefined;
}

export function mapFields(value: unknown, keys: readonly string[], plan: DataRelocationPlan): void {
  const object = record(value);
  if (!object) return;
  for (const key of keys)
    if (typeof object[key] === "string") {
      object[key] = relocateFileReference(object[key] as string, plan);
    }
}

export function mapAttachments(value: unknown, plan: DataRelocationPlan): void {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    mapFields(item, ["path", "url", "artifactUri"], plan);
    const attachment = record(item);
    mapFields(attachment?.source, ["path", "uri"], plan);
    mapFields(attachment?.metadata, ["artifactUri", "originalUrl"], plan);
  }
}

/** 只变更带明确应用格式和结构化引用的提示行，预览中的同名文本保持原样。 */
function generatedHint(value: unknown, previous: string, next: string, tool?: string): unknown {
  if (typeof value !== "string" || previous === next) return value;
  const lines = value.split("\n");
  if (tool === "Bash") {
    for (let index = lines.length - 1; index >= 0; index--) {
      const line = lines[index]!;
      if (
        /^Command (?:running in background|was manually backgrounded by user|exceeded the assistant-mode blocking budget)/.test(
          line,
        ) &&
        line.includes(` Output is being written to: ${previous}`)
      ) {
        lines[index] = line.replace(
          ` Output is being written to: ${previous}`,
          ` Output is being written to: ${next}`,
        );
        return lines.join("\n");
      }
    }
  }
  if ((tool === "Agent" || tool === "Task") && lines[0] === "Async agent launched successfully.") {
    const index = lines.indexOf(`output_file: ${previous}`);
    if (index >= 0) {
      lines[index] = `output_file: ${next}`;
      return lines.join("\n");
    }
  }
  if (tool === "TaskOutput" && value.startsWith("<retrieval_status>")) {
    return value.replace(
      `<output>\n[Truncated. Full output: ${previous}]\n\n`,
      `<output>\n[Truncated. Full output: ${next}]\n\n`,
    );
  }
  if (
    lines[0] === "<persisted-output>" &&
    lines[1]?.startsWith("Output too large (") &&
    lines[1].endsWith(`). Full output saved to: ${previous}`)
  ) {
    lines[1] = lines[1].slice(0, -previous.length) + next;
    return lines.join("\n");
  }
  const suffix = lines.at(-1);
  if (
    suffix?.startsWith(`[Tool output truncated by resultBudget: artifactPath=${previous}, `) &&
    suffix.endsWith("]")
  ) {
    lines[lines.length - 1] = suffix.replace(
      `artifactPath=${previous}, `,
      `artifactPath=${next}, `,
    );
    return lines.join("\n");
  }
  return value;
}

const OUTPUT_PATH_KEYS = [
  "artifactPath",
  "outputFile",
  "outputPath",
  "persistedOutputPath",
  "rawOutputPath",
  "stdoutPersistedOutputPath",
  "stderrPersistedOutputPath",
];
export function mapPart(value: unknown, plan: DataRelocationPlan): void {
  const part = record(value);
  if (!part) return;
  if (part.type === "file") {
    mapAttachments([part], plan);
    return;
  }
  if (part.type === "patch" && Array.isArray(part.files)) {
    part.files = part.files.map((path) =>
      typeof path === "string" ? relocateFileReference(path, plan) : path,
    );
    return;
  }
  if (part.type !== "tool") return;
  const state = record(part.state);
  if (!state) return;
  const metadata = record(state.metadata);
  const ownedOutputs = [metadata, record(metadata?.output)];
  const referencePairs = ownedOutputs.flatMap((output) =>
    OUTPUT_PATH_KEYS.flatMap((key) => {
      const previous = output?.[key];
      return typeof previous === "string"
        ? [[previous, relocateFileReference(previous, plan)] as const]
        : [];
    }),
  );
  for (const [previous, next] of referencePairs) {
    state.output = generatedHint(state.output, previous, next, String(part.tool));
    if (metadata && typeof metadata.modelContent === "string")
      metadata.modelContent = generatedHint(
        metadata.modelContent,
        previous,
        next,
        String(part.tool),
      );
  }
  const serialization = record(metadata?.serialization);
  const previous = serialization?.artifactPath;
  mapFields(serialization, ["artifactPath"], plan);
  if (typeof previous === "string" && typeof serialization?.artifactPath === "string") {
    state.output = generatedHint(state.output, previous, serialization.artifactPath);
    if (metadata && typeof metadata.modelContent === "string") {
      metadata.modelContent = generatedHint(
        metadata.modelContent,
        previous,
        serialization.artifactPath,
      );
    }
  }
  mapFields(metadata, OUTPUT_PATH_KEYS, plan);
  // metadata.output 是应用保留的结构化结果；不递归遍历插件返回的任意对象。
  mapFields(metadata?.output, OUTPUT_PATH_KEYS, plan);
  const display = record(metadata?.display);
  mapFields(display, [...OUTPUT_PATH_KEYS, "filePath"], plan);
  mapFields(display?.data, [...OUTPUT_PATH_KEYS, "filePath"], plan);
  mapAttachments(state.attachments, plan);
}

export function mapPendingInput(value: unknown, plan: DataRelocationPlan): void {
  const payload = record(value);
  if (!payload) return;
  mapAttachments(payload.attachments, plan);
  // 公共输入 envelope 的 prompt 字段承载结构化输入；text/content 始终保留。
  mapAttachments(record(payload.prompt)?.attachments, plan);
}
