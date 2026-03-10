import { clip, hashText, squeezeWhitespace } from "./utils.mjs";

export const XHS_PERSONA = {
  role: "OpenClaw 实战派",
  audience: ["开发者", "效率工具重度用户", "对自动化感兴趣的人"],
  tone: ["先讲踩坑", "先抛类比", "再讲判断", "最后给动作", "不装懂", "不喊口号"],
  bannedPhrases: ["今日 GitHub 热门", "项目名：", "一句话看点：", "技术栈先记一下"]
};

const RISKY_PATTERNS = [
  /暴富|稳赚|躺赚|引流神器|封神|闭眼入/g,
  /绕过审核|规避限流|过审技巧|洗稿/g,
  /一键起号|矩阵起号脚本|批量养号/g
];

const TITLE_PATTERNS = {
  workflow: [
    ({ shortName }) => `装了OpenClaw还是不会用？先跑一次${shortName}`,
    ({ shortName }) => `${shortName}能不能接进OpenClaw？我先试了`,
    ({ shortName }) => `我先把${shortName}塞进OpenClaw跑了一遍`
  ],
  tool: [
    ({ shortName }) => `${shortName}值不值得接OpenClaw？我先试了`,
    ({ shortName }) => `这个工具能接OpenClaw吗？我先拿${shortName}试了`,
    ({ shortName }) => `刷到${shortName}后，我先用OpenClaw跑了一遍`
  ],
  research: [
    ({ shortName }) => `这个GitHub热门，值不值得接OpenClaw？`,
    ({ shortName }) => `我拿OpenClaw试了${shortName}，结论有点意外`,
    ({ shortName }) => `${shortName}这么火，我先看它能不能进OpenClaw`
  ],
  general: [
    ({ shortName }) => `${shortName}能不能进OpenClaw？我先试了`,
    ({ shortName }) => `这个GitHub热门，我会先接进OpenClaw`,
    ({ shortName }) => `刷到${shortName}后，我先拿OpenClaw试了一遍`
  ]
};

const CTA_PATTERNS = [
  "如果你想看我下一条直接拆配置，评论区留“配置”。",
  "如果你想看我下一条把它接进真实工作流，评论区留“继续”。",
  "如果你想看我把这套链路拆成命令流，评论区留“命令流”。"
];

function pick(list, key, salt = "") {
  const source = hashText(`${key}:${salt}`);
  const index = parseInt(source.slice(0, 2), 16) % list.length;
  return list[index];
}

function sanitizeText(text) {
  let output = text;
  for (const pattern of RISKY_PATTERNS) {
    output = output.replace(pattern, "稳一点");
  }

  return squeezeWhitespace(output);
}

function repoSourceText(repo) {
  return [repo.fullName, repo.name, repo.description, repo.language, ...(repo.topics || [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function repoCategory(repo) {
  const source = repoSourceText(repo);

  if (/(workflow|agent|orchestr|automation|coordination|multi-agent|skill)/.test(source)) {
    return "workflow";
  }

  if (/(cli|sdk|editor|terminal|tool|devtool|package|manager)/.test(source)) {
    return "tool";
  }

  if (/(research|training|rag|llm|model|chat|inference)/.test(source)) {
    return "research";
  }

  return "general";
}

function isThreeMinistries(repo) {
  return /(three.?reflections|six.?ministries|三省六部|中书省|门下省|尚书省)/i.test(
    repoSourceText(repo)
  );
}

function shortRepoName(repo) {
  if (/^openclaw$/i.test(repo.name || "")) {
    return "这套流程";
  }

  return clip(repo.name || repo.fullName.split("/").pop() || "这个项目", 12);
}

function buildScenes(category, repo) {
  const repoShort = shortRepoName(repo);

  if (category === "workflow") {
    return ["先拆任务", "再挑漏洞", "最后收口", "再看能不能复用"];
  }

  if (category === "tool") {
    return ["先找输入输出", "再接脚本", "再看省不省步骤", `最后再看${repoShort}值不值`];
  }

  if (category === "research") {
    return ["先看场景", "再看上手成本", "再看值不值得接", "最后才决定要不要跟"];
  }

  return ["先看能不能落地", "再看会不会太重", "再看能不能复用", "最后才决定要不要留"];
}

function buildSupport(category) {
  if (category === "workflow") {
    return "不是模型没接好\n是协作流还没跑顺";
  }

  if (category === "tool") {
    return "先别看它有多火\n先看能不能进真实流程";
  }

  if (category === "research") {
    return "先别急着收藏\n先看它到底能不能省步骤";
  }

  return "别先追概念\n先看它能不能真的落地";
}

function splitTitleForCover(title) {
  const clean = String(title).replace(/\s+/g, "");
  const match = clean.match(/^(.{6,18}[？?])(.+)$/);

  if (match) {
    return {
      highlight: match[1],
      headline: match[2]
    };
  }

  const parts = clean.split(/[，,:：]/).filter(Boolean);
  if (parts.length >= 2) {
    return {
      highlight: clip(parts[0], 16),
      headline: parts.slice(1).join("")
    };
  }

  return {
    highlight: clip(clean, 14),
    headline: clean
  };
}

function buildHashtags(category, repo) {
  const tags = ["#OpenClaw", "#AI工作流", "#效率工具"];

  if (category === "workflow") {
    tags.push("#多智能体协作", "#内容创作");
  } else if (category === "tool") {
    tags.push("#自动化", "#开发者日常");
  } else {
    tags.push("#GitHub热门", "#内容创作");
  }

  if (repo.language && repo.language !== "Unknown") {
    tags.push(`#${repo.language}`);
  }

  return [...new Set(tags)].slice(0, 6).join(" ");
}

function buildCommentSeed(category, repo) {
  const repoShort = shortRepoName(repo);

  if (/^openclaw$/i.test(repo.name || "")) {
    return "如果你想看我下一条直接拆本地配置，我可以把这套流程跑顺给你看。";
  }

  if (category === "workflow") {
    return `如果你想看我下一条把 ${repoShort} 接进真实流程，我可以直接拆配置。`;
  }

  return `如果你想看我下一条把 ${repoShort} 接进 OpenClaw，我可以直接拆命令流。`;
}

function trendFallbackTitle(repo, draft, trendBrief) {
  if (!trendBrief) {
    return null;
  }

  const isCoreOpenClaw = /^openclaw$/i.test(repo.name || "");
  const repoShort = shortRepoName(repo);

  if (trendBrief.primaryHookKey === "judgment") {
    if (isCoreOpenClaw) {
      return "OpenClaw先别急着上重配置";
    }
    return `OpenClaw先别急着接${repoShort}`;
  }

  if (trendBrief.primaryHookKey === "listicle") {
    if (isCoreOpenClaw) {
      return "OpenClaw先跑这3个场景";
    }
    return `OpenClaw我先试了3个${repoShort}场景`;
  }

  if (trendBrief.primaryHookKey === "persona") {
    if (isCoreOpenClaw) {
      return "普通人用OpenClaw先看这3点";
    }
    return `普通人用OpenClaw，先试${repoShort}`;
  }

  return draft.title;
}

function trendFallbackIntro(repo, trendBrief) {
  if (!trendBrief) {
    return "";
  }

  if (trendBrief.primaryHookKey === "judgment") {
    return "我最近刷 OpenClaw，发现很多人卡住的不是模型，而是一上来就把配置拉太满。";
  }

  if (trendBrief.primaryHookKey === "listicle") {
    return "我最近在试 OpenClaw 时，先把能落地的场景列出来，反而比先折腾配置更有用。";
  }

  if (trendBrief.primaryHookKey === "persona") {
    return "我自己属于能不手动就不手动的人，所以最近一直在试 OpenClaw 到底值不值得留下。";
  }

  return /^openclaw$/i.test(repo.name || "")
    ? "我最近一直在试 OpenClaw 到底怎么落地。"
    : "";
}

function buildThreeMinistriesBody(repo) {
  return sanitizeText(`
我之前装 OpenClaw，最大的感受不是强，是乱。

任务一复杂，十几个 agent 像在群聊。
有人急着干活，没人先拆题，也没人专门挑错。

后来我才明白，问题根本不是模型不够强。
而是流程里一直没人“批奏折”。

所以我最近把“三省六部”这套 skill 接进来了。
它对我最有用的地方，不是多几个角色，而是终于有人固定做这 4 件事：

1. 先预筛：小事直接做，复杂任务再立项。
2. 再拆题：中书省把任务拆成能执行的小块。
3. 再挑错：门下省专门找漏洞，拦住拍脑袋方案。
4. 再分工收口：尚书省派给六部去干，最后把结果收回来。

六部我现在这样分：
- 吏部：看谁来接任务
- 户部：管数据和信息
- 礼部：写文案和对外表达
- 兵部：动代码和自动化
- 刑部：盯风险、权限、边界
- 工部：做部署、搭环境、收交付

我现在最常把它用在 3 类事：
- 写一条内容前，先拆题再定口径
- 跑一个需求前，先把风险和执行分开
- 做自动化前，先决定谁审核、谁落地

所以我现在对 OpenClaw 的理解变了：
不是多开几个 agent 就行，
而是先补上那个“替你批奏折的人”。

技能页：${repo.url}
如果你想看我下一条直接拆“本地怎么把三省六部接进 OpenClaw”，评论区留【配置】。
  `);
}

function buildThreeMinistriesDraft(repo) {
  const hashtags = normalizeHashtagString(
    "#OpenClaw #AI工作流 #多智能体协作 #效率工具 #自动化 #开发者日常"
  );
  const body = buildThreeMinistriesBody(repo);

  return {
    title: "我装了OpenClaw后，有人替我批奏折了",
    body: `${body}\n\n${hashtags}`,
    hashtags,
    commentSeed: "如果你想看我下一条直接拆本地配置，我就把三省六部的接法写出来。",
    ops: {
      persona: XHS_PERSONA,
      category: "workflow",
      coverPlan: {
        style: "diagram-note",
        badge: "OpenClaw 三省六部",
        note: "复杂任务终于\n不再跑散",
        footer: "不是多开 agent，是先有人批奏折",
        steps: [
          { title: "S0 预筛选", subtitle: "小事直做 | 难事立项" },
          { title: "中书省", subtitle: "拆题 | 拟方案" },
          { title: "门下省", subtitle: "挑漏洞 | 查假设" },
          { title: "尚书省", subtitle: "派任务 | 收结果" }
        ],
        departments: [
          { title: "吏部", subtitle: "人手" },
          { title: "户部", subtitle: "数据" },
          { title: "礼部", subtitle: "文案" },
          { title: "兵部", subtitle: "代码" },
          { title: "刑部", subtitle: "风险" },
          { title: "工部", subtitle: "部署" }
        ]
      }
    }
  };
}

function buildBody(repo, category, cta) {
  const description = repo.description || "方向是对的，但我更关心它能不能真的进流程。";

  if (category === "workflow") {
    return sanitizeText(`
我最近一直在试 OpenClaw 到底怎么落地。

很多时候不是模型没接好，而是任务一复杂，拆题、挑错、执行、收口全挤在一起。

刷到 ${repo.fullName} 后，我先想到的不是收藏，而是它能不能把这条协作流跑顺。

它的核心点我会先记成一句话：
${description}

如果我拿它进 OpenClaw，我会先这样测：
1. 先看它能不能把任务拆开，输入输出清不清楚。
2. 再看它能不能接进现有脚本、skill 或发布流。
3. 最后只看一个结果：有没有真的少走步骤。

像这种协作流类项目，我还会优先放进“三省六部”这种角色分工里，看它在拆题、挑错、执行、收口哪个环节真正有用。

我现在更愿意跟的，不是概念很满的 repo，而是能立刻进真实流程的东西。

GitHub：${repo.url}
${cta}
    `);
  }

  if (category === "tool") {
    return sanitizeText(`
我最近在试 OpenClaw 时，一个最大的感受是：

工具很多，但真正能留下来的不多。

刷到 ${repo.fullName} 后，我第一反应不是“它火不火”，而是“它能不能让我少走几步”。

它的核心点很简单：
${description}

如果把它接进 OpenClaw，我会先拿 3 件事判断：
1. 输入输出是不是足够清楚。
2. 能不能直接接进脚本、命令流或者 skill。
3. 跑完以后有没有真实节省时间。

如果这 3 件事都成立，它才值得我继续写。

GitHub：${repo.url}
${cta}
    `);
  }

  return sanitizeText(`
我最近一直在找 OpenClaw 的第一批实战场景。

刷到 ${repo.fullName} 后，我没急着收藏，先问自己一件事：
它能不能进真实流程。

这个项目最吸引我的地方不是概念，而是：
${description}

如果我真要把它接进 OpenClaw，我会先看 3 件事：
1. 有没有明确的输入输出。
2. 普通人第一次上手会不会太重。
3. 接进以后有没有实际收益。

我现在更在意的不是“最新最火”，而是“能不能立刻用一次”。

GitHub：${repo.url}
${cta}
  `);
}

export function normalizeHashtagString(input) {
  const source = Array.isArray(input) ? input.join(" ") : String(input || "");
  const tags = source
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => (item.startsWith("#") ? item : `#${item.replace(/^#+/, "")}`));

  return [...new Set(tags)].slice(0, 6).join(" ");
}

function applyTrendBrief(draft, trendBrief) {
  if (!trendBrief) {
    return draft;
  }

  const nextDraft = {
    ...draft
  };
  const coverPlan = {
    ...(draft.ops?.coverPlan || {})
  };

  if (trendBrief.primaryHookKey === "judgment") {
    coverPlan.highlight = `${trendBrief.topKeywords?.[0] || "普通人"}用`;
    coverPlan.headline = nextDraft.title;
    coverPlan.ctaLabel = "我踩过的坑";
  } else if (trendBrief.primaryHookKey === "listicle") {
    coverPlan.highlight = "先看这3点";
    coverPlan.headline = nextDraft.title;
    coverPlan.ctaLabel = "先看这3点";
  } else if (trendBrief.coverHook || draft.title) {
    const trendTitle = clip(nextDraft.title || "", 22);
    const titleParts = splitTitleForCover(trendTitle);
    coverPlan.highlight = titleParts.highlight;
    coverPlan.headline = titleParts.headline;
  }

  if (trendBrief.coverSupport) {
    coverPlan.support = trendBrief.coverSupport;
  }

  if (Array.isArray(trendBrief.coverChips) && trendBrief.coverChips.length > 0) {
    coverPlan.chips = trendBrief.coverChips.slice(0, 4);
  }

  if (trendBrief.coverStyle === "note-list") {
    coverPlan.ctaLabel = "先看这3点";
  } else if (trendBrief.coverStyle === "quote-note") {
    coverPlan.ctaLabel = "我踩过的坑";
  }

  return {
    ...nextDraft,
    ops: {
      ...draft.ops,
      trendBrief,
      coverPlan
    }
  };
}

export function buildOpsDraft(repo, trendBrief = null) {
  if (isThreeMinistries(repo)) {
    return applyTrendBrief(buildThreeMinistriesDraft(repo), trendBrief);
  }

  const category = repoCategory(repo);
  const shortName = shortRepoName(repo);
  const title = clip(pick(TITLE_PATTERNS[category], repo.fullName, shortName)({ shortName }), 22);
  const cta = pick(CTA_PATTERNS, repo.fullName, category);
  const titleParts = splitTitleForCover(title);
  const scenes = buildScenes(category, repo);
  const hashtags = normalizeHashtagString(buildHashtags(category, repo));
  const body = buildBody(repo, category, cta);

  const draft = {
    title,
    body: `${body}\n\n${hashtags}`,
    hashtags,
    commentSeed: sanitizeText(buildCommentSeed(category, repo)),
    ops: {
      persona: XHS_PERSONA,
      category,
      coverPlan: {
        badge: category === "workflow" ? "OpenClaw 实战" : "OpenClaw 亲测",
        highlight: titleParts.highlight,
        headline: titleParts.headline,
        support: buildSupport(category),
        ctaLabel: category === "workflow" ? "我现在这样用" : "我先这样试",
        chips: scenes
      }
    }
  };

  if (trendBrief) {
    const betterTitle = trendFallbackTitle(repo, draft, trendBrief);
    if (betterTitle) {
      draft.title = clip(betterTitle, 22);
    }

    const intro = trendFallbackIntro(repo, trendBrief);
    if (intro) {
      const bodyWithoutFirstLine = draft.body.replace(/^[^\n]+/, intro);
      draft.body = bodyWithoutFirstLine;
    }
  }

  return applyTrendBrief(draft, trendBrief);
}

export function buildOpsRefinePrompt(repo, draft, trendBrief = null) {
  const trendSection = trendBrief
    ? `
近期小红书热帖学习：
- 当前有效钩子：${(trendBrief.primaryHooks || []).join("、") || "判断句、清单句"}
- 标题规则：${(trendBrief.titleRules || []).join(" / ")}
- 封面规则：${(trendBrief.coverRules || []).join(" / ")}
- 正文规则：${(trendBrief.bodyRules || []).join(" / ")}
- 只学结构和节奏，不要复写热门帖原句。
`.trim()
    : "";

  return `
请按“小红书运营 workflow”润色下面这篇中文科技图文草稿。

账号设定：
- 人设：${XHS_PERSONA.role}
- 受众：${XHS_PERSONA.audience.join("、")}
- 语气：${XHS_PERSONA.tone.join("、")}

改写要求：
- 标题必须像小红书高互动科技图文，不像说明书
- 标题优先用 痛点句 / 判断句 / “我先试了” 这 3 类
- 正文必须先讲自己为什么在看 OpenClaw，再讲这个项目值不值得进流程
- 不要写成 repo 介绍卡，不要出现“项目名：”“一句话看点：”“技术栈先记一下”
- 每段尽量短，一两句一段
- 保留 GitHub 链接，但放在靠后位置
- 保留评论区互动口令
- 合法合规，不要写绕审核、限流、伪装、灰产

仓库信息：
- fullName: ${repo.fullName}
- description: ${repo.description || "暂无描述"}
- language: ${repo.language || "Unknown"}
- url: ${repo.url}

草稿：
标题：${draft.title}
正文：${draft.body}
评论引导：${draft.commentSeed}

${trendSection}

只输出改写后的正文，不要解释。
  `.trim();
}

export function sanitizeOpsText(text) {
  return sanitizeText(text);
}
