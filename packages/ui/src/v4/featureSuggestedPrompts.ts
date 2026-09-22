/* eslint-disable max-lines -- 推荐语料按表格逐条维护，集中放置便于对照审核。 */
import finderIcon from "@/onboarding/assets/finder.png";
import terminalIcon from "@/onboarding/assets/terminal.png";
import type { DraftSuggestedPromptItem } from "@/v4/draftSuggestedPromptItems.js";

type FeatureRecommendedPrompt = DraftSuggestedPromptItem & {
  mode: "office" | "coding";
};

// 本期推荐按模式硬分池；展示文案和填入正文分别维护。
// 官方 CDN 资产已随官方服务移除：条目不再引用远端图标，无本地资源时由 UI 默认头像降级。
export const featureSuggestedPrompts: FeatureRecommendedPrompt[] = [
  {
    id: "feature-recvvsPdvcWQzF",
    mode: "office",
    iconUrl: terminalIcon,
    label: {
      cn: "帮我看看电脑空间主要被什么占满了",
      en: "Show what is using up space on my computer",
    },
    prompt: {
      cn: "帮我分析这台电脑的磁盘占用情况，找出占空间最多的目录和大文件，区分系统文件、应用数据与个人文件。告诉我哪些可以考虑清理、预计能释放多少空间；先不要删除任何文件。",
      en: "Analyze disk usage on this computer. Identify the largest directories and files, distinguish system files, application data, and personal files, and estimate what I could safely clean up. Do not delete any files.",
    },
  },
  {
    id: "feature-recvvsQoVaqVGC",
    mode: "office",
    iconStyle: "plugin",
    label: {
      cn: "每天推送我关注方向的最新新闻并生成简报",
      en: "Send me a daily briefing on news I care about",
    },
    prompt: {
      cn: "帮我设置一个每天上午 9 点运行的定时任务：使用 [@浏览器操作](plugin://browser-use@zcode-plugins-official) 浏览可访问的公开新闻网站，收集过去 24 小时内与 [关注方向] 相关的重要新闻，去重后生成一份简短简报并推送给我。每条写清事件发生时间、新闻发布时间、来源链接和为什么值得关注；没有可信的新消息就如实说明，不要重复昨天的内容。",
      en: "Set up a scheduled task for 9 a.m. every day. Use [@Browser Use](plugin://browser-use@zcode-plugins-official) to check accessible public news sites for important news about [topic of interest] from the past 24 hours, remove duplicates, and send me a brief digest. Include event and publication times, source links, and why each item matters. Say when there is no credible new item and do not repeat yesterday’s news.",
    },
    plugin: {
      stableId: "browser-use@zcode-plugins-official",
      label: { cn: "浏览器操作", en: "Browser Use" },
    },
  },
  {
    id: "feature-office-browser-business-reading",
    mode: "office",
    iconStyle: "plugin",
    label: {
      cn: "帮我挑出今天值得读的三篇商业文章",
      en: "Find three business stories worth reading today",
    },
    prompt: {
      cn: "请使用 [@浏览器操作](plugin://browser-use@zcode-plugins-official) 浏览界面新闻等国内公开商业资讯网站，打开文章正文，选出今天最值得职场人阅读的三篇商业文章。每篇告诉我核心信息、推荐理由、发布时间和原文链接。跳过重复报道、付费文章和需要登录的页面；如果合适的不足三篇，就按实际数量推荐。",
      en: "Use [@Browser Use](plugin://browser-use@zcode-plugins-official) to browse publicly accessible business coverage from The Guardian and other international news sites. Open the full articles and pick three worth reading today. For each, give me the key information, why it is worth my time, the publication time, and the original link. Skip duplicate coverage, paywalled articles, and pages requiring sign-in. Recommend fewer than three if necessary.",
    },
    plugin: {
      stableId: "browser-use@zcode-plugins-official",
      label: { cn: "浏览器操作", en: "Browser Use" },
    },
  },
  {
    id: "feature-office-browser-work-reading",
    mode: "office",
    iconStyle: "plugin",
    label: {
      cn: "帮我找几篇能用在工作中的好文章",
      en: "Find practical articles I can use at work",
    },
    prompt: {
      cn: "请使用 [@浏览器操作](plugin://browser-use@zcode-plugins-official) 查看人人都是产品经理的公开文章，从最近发布的内容中挑三篇对日常办公、沟通协作或提升工作效率有具体帮助的文章。打开正文后，分别说明适合谁读、有什么可借鉴的做法、应用时要注意什么，并附原文链接。不要只根据标题推荐，也不要选择需要登录或付费才能读的内容。",
      en: "Use [@Browser Use](plugin://browser-use@zcode-plugins-official) to read recent, publicly accessible articles from Microsoft WorkLab and Atlassian Team Playbook. Pick three with concrete ideas for everyday work or collaboration. Read each page before explaining who it helps, what I could try, what to watch out for, and where to read the original. Do not recommend from titles alone or include pages that require sign-in or payment.",
    },
    plugin: {
      stableId: "browser-use@zcode-plugins-official",
      label: { cn: "浏览器操作", en: "Browser Use" },
    },
  },
  {
    id: "feature-office-browser-economic-data",
    mode: "office",
    iconStyle: "plugin",
    label: {
      cn: "帮我看懂最近公布的重要经济数据",
      en: "Explain the latest economic data in plain language",
    },
    prompt: {
      cn: "请使用 [@浏览器操作](plugin://browser-use@zcode-plugins-official) 查看国家统计局公开数据中最近一次发布的主要经济信息。选出与消费、就业或企业经营相关的三项，说明统计时间、数据变化和普通办公人员为什么可能需要关注，附官方原文链接。把数据事实与自己的解读分开；如果本周没有新数据，就明确写出实际发布日期。",
      en: "Use [@Browser Use](plugin://browser-use@zcode-plugins-official) to review the latest publicly released OECD economic data. Choose three indicators relevant to consumers, employment, or business activity. Explain the reporting period, what changed, and why someone working in an office might care, with links to the original OECD releases. Separate reported facts from your interpretation and state the actual release dates if there is nothing new this week.",
    },
    plugin: {
      stableId: "browser-use@zcode-plugins-official",
      label: { cn: "浏览器操作", en: "Browser Use" },
    },
  },
  {
    id: "feature-recvvsPdvcPqQQ",
    mode: "office",
    iconUrl: finderIcon,
    label: {
      cn: "帮我看看这台电脑的下载文件夹应该如何整理一下？",
      en: "Find what I should clean up in Downloads",
    },
    prompt: {
      cn: "帮我看看这台电脑下载文件夹里有哪些大量重复文件、旧安装包和明显的临时文件，按预计可释放空间排序，并给出整理建议。先不要移动或删除文件。",
      en: "Inspect this computer’s Downloads folder for duplicates, old installers, and obvious temporary files. Rank the opportunities by space they could free and suggest an organization plan. Do not move or delete anything yet.",
    },
  },
  {
    id: "feature-recvvsPdvcK0EZ",
    mode: "office",
    iconUrl: terminalIcon,
    label: {
      cn: "看看我的电脑最近为什么变慢了",
      en: "Find out why my computer feels slow",
    },
    prompt: {
      cn: "帮我检查这台电脑当前的资源占用，找出可能让它变慢的进程和磁盘、内存压力。区分眼下可观察到的事实和可能原因，并告诉我可以先做哪几件安全的事。不要结束进程或改系统设置。",
      en: "Check current resource use on this computer and identify processes, disk pressure, or memory pressure that may explain why it feels slow. Separate what you can observe from possible causes, and suggest safe first steps. Do not terminate processes or change system settings.",
    },
  },
  {
    id: "feature-recvvsV4e4FqWU",
    mode: "office",
    label: {
      cn: "结合 Wind、同花顺和天眼查研究一家企业",
      en: "Research a company across three data sources",
    },
    prompt: {
      cn: "我想全面了解 [目标企业]。请结合我已连接的 [@Wind 万得](plugin://wind@zcode-plugins-official)、[@同花顺](plugin://hexin@zcode-plugins-official) 和 [@天眼查](plugin://tianyancha@zcode-plugins-official)，分别核对经营与市场数据、近期公告及企业关系和风险，再整理一份简短研究报告。相互矛盾的数据请列出口径和时间差，不要强行合并；缺少某个数据源就说明未覆盖的部分。",
      en: "Help me understand [target company]. Cross-check connected [@Wind](plugin://wind@zcode-plugins-official), [@RoyalFlush iFinD](plugin://hexin@zcode-plugins-official), and [@Tianyancha](plugin://tianyancha@zcode-plugins-official) for operating and market data, recent filings, company relationships, and risks. Write a concise report, preserve conflicting figures with their dates and definitions, and say which sources were unavailable.",
    },
  },
  {
    id: "feature-coding-repo-start",
    mode: "coding",
    iconUrl: terminalIcon,
    label: {
      cn: "帮我看懂并运行当前仓库",
      en: "Help me understand and run this repository",
    },
    prompt: {
      cn: "帮我快速了解当前打开的仓库是做什么的、主要功能在哪里，以及在这台电脑上怎样启动它。请实际尝试运行一个最核心的流程，最后给我一份简明上手说明，标出关键文件、运行结果和遇到的阻碍；如果当前没有打开仓库，先让我选择一个。",
      en: "Help me understand what the open repository does, where its main features live, and how to run it on this computer. Try one core workflow, then give me a concise guide with key files, what ran successfully, and any blockers. If no repository is open, ask me to select one.",
    },
  },
  {
    id: "feature-coding-branch-review",
    mode: "coding",
    label: {
      cn: "帮我检查当前分支提交前的问题",
      en: "Check this branch before I submit it",
    },
    prompt: {
      cn: "请检查当前打开的仓库里这个分支准备提交的改动。先确认它相对哪个目标分支，再结合改动涉及的功能找出明确的错误、兼容性风险和遗漏的边界；按严重程度告诉我问题、代码位置、触发方式和建议。如果没有发现可确认的问题，也说明检查了什么和仍需验证什么。",
      en: "Review the changes on the current branch of the open repository before I submit them. Identify the target branch, then look for concrete bugs, compatibility risks, and missed edge cases in the affected features. Rank findings by severity with code locations, triggers, and suggestions. If nothing is confirmed, tell me what was checked and what still needs verification.",
    },
  },
  {
    id: "feature-coding-check-failures",
    mode: "coding",
    iconUrl: terminalIcon,
    label: {
      cn: "帮我运行项目现有检查并定位失败",
      en: "Run the existing checks and diagnose failures",
    },
    prompt: {
      cn: "帮我检查当前仓库现有的代码检查和测试能否通过。请优先运行项目已经配置、在当前环境可执行的检查；如果失败，定位最可能的原因，区分本分支引入的问题和原有问题，并给我可执行的修复建议。不要把没运行的检查写成通过，也先不要大范围改代码。",
      en: "Check whether the open repository’s existing code checks and tests pass. Run the checks already configured and feasible in this environment. For failures, identify likely causes, separate issues introduced by this branch from existing ones, and suggest actionable fixes. Do not call unrun checks passes or make broad code changes yet.",
    },
  },
  {
    id: "feature-coding-mr-summary",
    mode: "coding",
    label: {
      cn: "帮我整理当前分支的 MR 描述",
      en: "Draft a merge request description for this branch",
    },
    prompt: {
      cn: "请根据当前仓库这个分支相对目标分支的实际改动，帮我写一份可以直接检查的 MR 描述：说明改动目的、用户可见的变化、主要实现、验证结果和已知风险。没有运行过的验证请明确标为未验证；如果目标分支不明确，先向我确认。先给我草稿，不要直接发布 MR。",
      en: "Draft a merge request description from this branch’s actual changes against its target branch. Cover the purpose, user-visible behavior, main implementation, verification results, and known risks. Mark checks that were not run as unverified. Ask me if the target branch is unclear. Show me the draft without publishing the MR.",
    },
  },
  {
    id: "feature-coding-dependencies",
    mode: "coding",
    iconUrl: terminalIcon,
    label: {
      cn: "帮我检查仓库的依赖和升级风险",
      en: "Review this repository’s dependencies and upgrade risks",
    },
    prompt: {
      cn: "帮我检查当前仓库的主要依赖，找出已经过时、存在明确安全风险或阻碍后续升级的部分。结合项目实际使用情况，按优先级给我一份清单，说明影响、证据和建议的升级顺序；不要仅凭版本旧就判定有问题，也先不要批量升级。",
      en: "Review the open repository’s main dependencies for outdated packages, confirmed security risks, and likely upgrade blockers. Consider how this project actually uses them, then give me a prioritized list with impact, evidence, and a suggested upgrade order. Do not treat age alone as a defect or upgrade everything yet.",
    },
  },
  {
    id: "feature-recvvsWf8gXmsB",
    mode: "coding",
    label: {
      cn: "帮我设置一个闲时任务，全面验证仓库的测试覆盖",
      en: "Run a thorough test coverage review of a repository",
    },
    prompt: {
      cn: "帮我设置一个闲时任务，以 [目标仓库] 这个本地仓库为任务项目，全面检查关键功能的测试覆盖。运行当前环境支持的单元测试、集成测试和端到端测试，补齐重要缺口并复跑。最后给我一份详尽报告，列出覆盖范围、通过和失败项、无法运行的项目、证据及剩余风险。不要把未运行的测试写成通过；如果仓库未作为本地项目打开，先让我选择它。",
      en: "Set up an idle-time task for the local [target repository]. Review coverage of important features, run unit, integration, and end-to-end tests that the environment supports, add tests for important gaps, and rerun them. Deliver a detailed report of coverage, passes, failures, tests that could not run, evidence, and remaining risks. Never call an unrun test a pass. Ask me to select the repository if it is not open.",
    },
  },
  {
    id: "feature-recvvsWf8g0Cg0",
    mode: "coding",
    label: {
      cn: "帮我设置一个闲时任务，读透仓库并画出功能地图",
      en: "Read a repository deeply and map its features",
    },
    prompt: {
      cn: "帮我设置一个闲时任务，以 [目标仓库] 这个本地仓库为任务项目，系统梳理主要功能、模块职责、关键数据流和入口到结果的调用链。阅读必要的代码与文档，标出重要依赖、容易误解的边界和当前文档缺口，最后交付一份附文件位置的仓库导览和功能地图。没有代码依据的判断请标为推测；如果仓库未作为本地项目打开，先让我选择它。",
      en: "Set up an idle-time task for the local [target repository]. Map the main features, module responsibilities, data flows, and paths from entry point to result. Read the relevant code and docs, identify dependencies and confusing boundaries, and deliver a repository guide with file references. Label claims without code evidence as inference. Ask me to select the repository if it is not open.",
    },
  },
  {
    id: "feature-recvvsWf8grDkJ",
    mode: "coding",
    label: {
      cn: "帮我设置一个闲时任务，深查仓库潜在问题",
      en: "Find significant issues across a repository",
    },
    prompt: {
      cn: "帮我设置一个闲时任务，以 [目标仓库] 这个本地仓库为任务项目，全面检查关键用户流程和跨模块调用，找出可能导致功能错误、兼容性问题或数据丢失的缺陷。对高风险问题尽量复现并核对相关测试，最后按严重程度给我一份详尽报告，包含触发条件、代码位置、证据、修复建议及未验证假设。先不要大范围修改代码；如果仓库未作为本地项目打开，先让我选择它。",
      en: "Set up an idle-time task for the local [target repository]. Review important user journeys and cross-module calls for functional, compatibility, or data-loss issues. Reproduce high-risk findings where possible, check relevant tests, and deliver a detailed severity-ranked report with triggers, code locations, evidence, suggested fixes, and unverified hypotheses. Avoid broad code changes. Ask me to select the repository if it is not open.",
    },
  },
  {
    id: "feature-coding-browser-deployed",
    mode: "coding",
    iconStyle: "plugin",
    label: {
      cn: "帮我检查刚部署的网站有没有明显错误",
      en: "Check a deployed website for obvious problems",
    },
    prompt: {
      cn: "请使用 [@浏览器操作](plugin://browser-use@zcode-plugins-official) 打开 [测试地址]，像首次访问的用户一样检查首页导航、主要入口和一个无需登录即可完成的流程。找出无法打开的页面、失效操作或明显的内容与布局错误，附复现步骤、页面地址和截图。不要注册、付款或提交真实信息；登录后的部分标为未覆盖。",
      en: "Use [@Browser Use](plugin://browser-use@zcode-plugins-official) to open [test URL] and check its navigation, main entry points, and one flow available without signing in. Report broken pages, controls, content, or layout with reproduction steps, URLs, and screenshots. Do not register, pay, or submit real information; mark signed-in areas as not covered.",
    },
    plugin: {
      stableId: "browser-use@zcode-plugins-official",
      label: { cn: "浏览器操作", en: "Browser Use" },
    },
  },
  {
    id: "feature-coding-scheduled-ci",
    mode: "coding",
    label: {
      cn: "每天检查当前仓库有没有新的 CI 失败",
      en: "Check this repository for new CI failures daily",
    },
    prompt: {
      cn: "帮我为当前打开的仓库设置一个每个工作日上午 9 点运行的定时任务，查看远端过去 24 小时新增的 CI 失败。只报告仍需处理的失败，列出失败的流水线或任务、对应分支与提交、错误证据和建议的下一步；没有新的失败就简短说明。若仓库没有远端 CI 或运行环境无权访问，创建前先告诉我。",
      en: "Set up a scheduled task for 9 a.m. every workday for the open repository. Check its remote CI for failures newly seen in the past 24 hours. Report only failures that still need attention, with the pipeline or job, branch and commit, error evidence, and a next step. Give a brief all-clear if there are none. Tell me before creating the task if the repository has no remote CI or the scheduled environment cannot access it.",
    },
  },
  {
    id: "feature-coding-scheduled-weekly-changes",
    mode: "coding",
    label: {
      cn: "每周汇总当前仓库的改动和待处理风险",
      en: "Summarize this repository’s changes and risks weekly",
    },
    prompt: {
      cn: "帮我为当前打开的仓库设置一个每周五下午 5 点运行的定时任务，回顾这一周合入的改动和仍未解决的失败或阻塞。给我一份简短周报，按功能变化、验证情况和下周需要关注的风险整理，并附对应提交、MR 或 CI 链接。不要把尚未合入的改动写成已完成；如果任务运行环境无法访问仓库或远端，创建前先说明。",
      en: "Set up a scheduled task for 5 p.m. every Friday for the open repository. Review changes merged this week and failures or blockers still open. Send me a short update grouped by feature changes, verification, and risks to watch next week, with commit, merge request, or CI links. Do not call unmerged work complete. Tell me before creating the task if its environment cannot access the repository or remote.",
    },
  },
  {
    id: "feature-coding-idle-external-failures",
    mode: "coding",
    label: {
      cn: "帮我设置闲时任务，深查外部服务失败路径",
      en: "Deeply review external-service failure paths in idle time",
    },
    prompt: {
      cn: "帮我设置一个闲时任务，以当前打开的本地仓库为项目，系统检查它调用的外部 API、数据库和第三方服务在超时、断连、限流与返回错误时会怎样影响关键用户流程。追到调用方和用户可见结果，尽量复现高风险缺口，最后按严重程度给我一份附代码位置、运行证据和修复建议的报告。不要把没有实际验证的风险写成已发生的故障，也先不要大范围修改代码；如果没有打开本地仓库，先让我选择一个。",
      en: "Set up an idle-time task for the open local repository. Trace how timeouts, disconnections, rate limits, and errors from external APIs, databases, and third-party services affect important user flows. Follow each path to the caller and user-visible result, reproduce high-risk gaps where feasible, and deliver a severity-ranked report with code locations, runtime evidence, and fixes. Do not present unverified risks as incidents or make broad code changes. Ask me to select a local repository if none is open.",
    },
  },
];

export function getRecommendedPromptPool(isOfficeMode: boolean): DraftSuggestedPromptItem[] {
  const mode = isOfficeMode ? "office" : "coding";
  return featureSuggestedPrompts.filter((item) => item.mode === mode);
}
