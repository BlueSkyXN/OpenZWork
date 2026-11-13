export const moduleDefinition = {
  id: "managed-worktree-shared",
  // OpenZWork：依赖 shared 的 productIdentity（受管根目录名 = OPENZWORK_DATA_DIR_NAME）。
  requires: ["shared"],
  provides: ["managed-worktree-layout", "workspace-hook-trust-identity"],
} as const;
