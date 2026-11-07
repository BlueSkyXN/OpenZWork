# 普通 Node CLI/Web 发行的内置技能资产

- `build-zcode.mjs` 的 stageZCodePackage 是普通 Node tarball 资产组装唯一入口。
- 完整技能树来自仓库 `apps/zcode-cli/packages/bundled-skills/skills`，复制到 `agent/packages/bundled-skills/skills`；沿现有入口邻近发现规则，不能依赖源码 cwd 或用户缓存。
- 复用现有 SEA 构建资产清单；源和复制后目标的 SKILL.md、patterns.md、examples.md 必须为普通可读文件。缺任一文件打包失败，不产出残缺成功包。
- 保留技能加载历史检查（428）和保存工作流/设置修改的例外；不改变 runtime 会话状态。
- 本次不改 Desktop/SEA 发行链，不引入产品账号、设备标识或官方服务资源。

```text
源码 skills → stageZCodePackage → 完整资产验证 → tarball
  → 仓库外解包/全新临时 HOME → 实际 CLI skills list/inspect
  → bundled 来源与正文/引用可读
```

## 验收

- 合成目录验证完整技能树（含额外引用文件）复制；缺各必需文件、目录代替必需文件均失败。
- 用真实构建 tarball 在仓库外空 HOME/cwd 解包，清理宿主 ZCODE\_\*、NODE_PATH/NODE_OPTIONS；实际发行 CLI list/inspect dynamic-workflows 成功且来源 bundled，三文件与源码字节一致。
- 全新临时 HOME 用真实 install.sh 安装真实负载，同样执行实际 CLI 检查；不发送模型请求，不接触真实用户目录。
- Web 共享该 Agent 资产。可另做本地 HTTP 启动冒烟，但真实模型工作流执行、SSH/WSL/Docker 和完整离线验收仍独立未完成。
