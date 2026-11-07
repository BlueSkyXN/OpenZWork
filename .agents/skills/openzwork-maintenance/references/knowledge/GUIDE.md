# 经验库：记录与治理

`knowledge/` 保存跨任务可复用的维护经验，分三份：

| 文件 | 内容 | 编号 |
| --- | --- | --- |
| `pitfalls.yaml` | 踩过的坑与规避方法 | `OZK-PIT-NNN` |
| `diff.yaml` | 阅读 diff、识别来源与合并冲突的方法 | `OZK-DIF-NNN` |
| `decisions.yaml` | 同类上游改动的取舍先例 | `OZK-DEC-NNN` |

具体某个功能的决定写在台账中；`decisions.yaml` 只写可以套用到同类情况的判断规则。

## 准入

只有同时满足以下条件的经验才写入：

1. 来自实际任务，并已验证。
2. 有可核对的证据：提交号、PR 编号、仓库文件路径或 spec 段落。文件路径必须存在，CI 会检查。
3. 能写成一个具体做法，并说清适用场景。

推测、一次性的过程信息、某次运行的数字，以及代码或 Git 历史中已有的事实，不写入。

## 写入流程

1. 在三份文件中搜索关键词。已有相近条目时，更新原条目的 `do`、`why`、`evidence` 和 `checked`，不新建。
2. 新建时取该文件中最大编号加一，按下方模板填写全部字段。
3. 与产生这条经验的改动放在同一个 PR 中提交。

```yaml
  - id: OZK-PIT-011
    title: 不超过 40 字的标题
    when: 适用场景。
    do: 具体做法。
    why: 依据：发生过什么、根因是什么。
    evidence:
      - PR #00
      - path/to/file
    since: YYYY-MM-DD
    checked: X.Y.Z        # 最近确认仍成立的上游版本
    status: active
```

## 维护

- 合入上游新版本时，复核与本次改动相关的条目，仍成立的把 `checked` 改为新版本。
- 条目错误或过时：有替代条目时把 `status` 改为 `superseded` 并填写 `supersededBy`；没有替代时删除。
- 每份文件的 `active` 条目不超过 40 条，超过时先合并同类条目。
- 字段、编号、日期格式、证据路径与数量上限由 `pnpm openzwork:scan --check` 校验。
