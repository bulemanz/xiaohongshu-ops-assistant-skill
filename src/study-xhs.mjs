import { pathToFileURL } from "node:url";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULTS, STUDY_DIR, ARTIFACTS_DIR } from "./config.mjs";
import { dumpUiXml, openDeepLink, screenshot, sleep, swipe } from "./adb.mjs";
import { parseUiXml } from "./ui-xml.mjs";
import {
  clip,
  dateKey,
  ensureDir,
  fileExists,
  hashText,
  nowIso,
  readJson,
  slugify,
  squeezeWhitespace,
  writeJson,
  writeText
} from "./utils.mjs";

const TOP_CHROME_TEXTS = new Set([
  "全部",
  "用户",
  "商品",
  "图片",
  "地点",
  "问一问",
  "综合",
  "最新",
  "搜索",
  "返回",
  "全部删除"
]);

const STYLE_RULES = [
  { key: "judgment", label: "判断句", pattern: /听劝|先别|别急|别碰|不建议|问题不在|真正|到底/ },
  { key: "listicle", label: "清单句", pattern: /(?:\d+|[一二三四五六七八九十]+)(?:个|条|套|种)?(?:玩法|场景|步骤|配置|问题)/ },
  { key: "persona", label: "人设开头", pattern: /我是|普通人|产品经理|小白|懒人|打工人/ },
  { key: "metaphor", label: "类比翻译", pattern: /龙虾|批奏折|老板|公司|分身|奏折/ },
  { key: "application", label: "实战应用", pattern: /办公|提效|自动化|工作流|配置|上手|实战|场景/ }
];

const KEY_PHRASES = [
  "玩法",
  "普通人",
  "产品经理",
  "配置",
  "上手",
  "场景",
  "工作流",
  "自动化",
  "批奏折",
  "龙虾",
  "办公提效",
  "三省六部"
];

function studyDayDir(dayKeyValue) {
  return `${STUDY_DIR}/${dayKeyValue}`;
}

function studyPath(dayKeyValue, keyword) {
  return `${studyDayDir(dayKeyValue)}/${slugify(keyword)}.json`;
}

function artifactsDir(dayKeyValue, keyword) {
  return `${ARTIFACTS_DIR}/study/${dayKeyValue}/${slugify(keyword)}`;
}

function resultRoute(keyword) {
  return `xhsdiscover://search/result?keyword=${encodeURIComponent(keyword)}`;
}

function rectWidth(bounds) {
  return bounds.right - bounds.left;
}

function rectHeight(bounds) {
  return bounds.bottom - bounds.top;
}

function rectArea(bounds) {
  return rectWidth(bounds) * rectHeight(bounds);
}

function containsBounds(outer, inner) {
  return (
    outer &&
    inner &&
    outer.left <= inner.left &&
    outer.top <= inner.top &&
    outer.right >= inner.right &&
    outer.bottom >= inner.bottom
  );
}

function sameBounds(left, right) {
  return (
    left &&
    right &&
    left.left === right.left &&
    left.top === right.top &&
    left.right === right.right &&
    left.bottom === right.bottom
  );
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyFn(item);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function isAgeLabel(text) {
  return /^(今天|昨天|\d+分钟前|\d+小时前|\d+天前|\d{2}-\d{2})$/.test(text);
}

function isLikeLabel(text) {
  return /^(?:\d+(?:\.\d+)?(?:万|w|W)?|\d+)$/.test(text);
}

function normalizeLikeCount(text) {
  const value = String(text || "").trim();
  if (!value) return 0;
  if (/[万wW]$/.test(value)) {
    return Math.round(Number(value.replace(/[万wW]/g, "")) * 10000);
  }
  return Number(value.replace(/[^\d.]/g, "")) || 0;
}

function parseAgeDays(text, referenceDate, timeZone) {
  const value = String(text || "").trim();
  if (!value) return null;

  if (value === "今天" || /分钟前|小时前/.test(value)) {
    return 0;
  }

  if (value === "昨天") {
    return 1;
  }

  const dayMatch = value.match(/^(\d+)天前$/);
  if (dayMatch) {
    return Number(dayMatch[1]);
  }

  const monthDayMatch = value.match(/^(\d{2})-(\d{2})$/);
  if (monthDayMatch) {
    const currentKey = dateKey(referenceDate, timeZone);
    const year = Number(currentKey.slice(0, 4));
    const month = Number(monthDayMatch[1]);
    const day = Number(monthDayMatch[2]);
    const currentDate = new Date(`${currentKey}T00:00:00Z`);
    const sampleDate = new Date(Date.UTC(year, month - 1, day));
    const diffMs = currentDate.getTime() - sampleDate.getTime();
    return Math.floor(diffMs / (24 * 60 * 60 * 1000));
  }

  return null;
}

function splitHeadlineAndSnippet(text) {
  const source = squeezeWhitespace(String(text || ""));
  if (!source) {
    return { headline: "", snippet: "" };
  }

  const cueMatch = source.match(/\s+(朋友们|最近|我是|我|作为|很多人|身边|先说|如果|所以)/);
  if (cueMatch && cueMatch.index >= 10) {
    return {
      headline: source.slice(0, cueMatch.index).trim(),
      snippet: source.slice(cueMatch.index).trim()
    };
  }

  const punctuationIndex = [...source].findIndex((char, index) => index >= 10 && /[。！？?]/.test(char));
  if (punctuationIndex !== -1) {
    return {
      headline: source.slice(0, punctuationIndex + 1).trim(),
      snippet: source.slice(punctuationIndex + 1).trim()
    };
  }

  return {
    headline: clip(source, 28),
    snippet: source.length > 28 ? source.slice(28).trim() : ""
  };
}

function candidateCards(nodes) {
  return uniqueBy(
    nodes
      .filter((node) => {
        if (!node.clickable || !node.bounds) return false;
        if (node.bounds.top < 500) return false;
        if (rectWidth(node.bounds) < 440) return false;
        if (rectHeight(node.bounds) < 540) return false;
        return true;
      })
      .sort((left, right) => {
        if (left.bounds.top !== right.bounds.top) {
          return left.bounds.top - right.bounds.top;
        }
        if (left.bounds.left !== right.bounds.left) {
          return left.bounds.left - right.bounds.left;
        }
        return rectArea(right.bounds) - rectArea(left.bounds);
      }),
    (node) => `${node.bounds.left},${node.bounds.top},${node.bounds.right},${node.bounds.bottom}`
  );
}

function extractCard(nodes, cardNode, keyword, pageNumber, referenceDate, timeZone) {
  const textNodes = nodes
    .filter((node) => {
      const value = String(node.text || "").trim();
      return value && node.bounds && containsBounds(cardNode.bounds, node.bounds);
    })
    .sort((left, right) => {
      if (left.bounds.top !== right.bounds.top) {
        return left.bounds.top - right.bounds.top;
      }
      return left.bounds.left - right.bounds.left;
    });

  const visibleTexts = uniqueBy(
    textNodes.map((node) => ({ ...node, text: squeezeWhitespace(node.text) })),
    (node) => `${node.text}|${node.bounds.left}|${node.bounds.top}`
  )
    .map((node) => node.text)
    .filter((text) => text && !TOP_CHROME_TEXTS.has(text));

  if (visibleTexts.length === 0) {
    return null;
  }

  const bodyText = visibleTexts
    .filter((text) => !isAgeLabel(text) && !isLikeLabel(text))
    .sort((left, right) => right.length - left.length)[0];

  if (!bodyText) {
    return null;
  }

  const footerNodes = textNodes.filter(
    (node) => node.bounds.top >= cardNode.bounds.bottom - 140 && node.bounds.bottom <= cardNode.bounds.bottom + 4
  );
  const ageNode = footerNodes.find((node) => isAgeLabel(node.text));
  const likeNode = [...footerNodes]
    .reverse()
    .find((node) => isLikeLabel(node.text) && node.bounds.left >= cardNode.bounds.centerX - 30);
  const authorNode = footerNodes.find((node) => {
    const value = String(node.text || "").trim();
    if (!value || value === keyword) return false;
    if (isAgeLabel(value) || isLikeLabel(value)) return false;
    return value.length <= 24;
  });

  const { headline, snippet } = splitHeadlineAndSnippet(bodyText);
  const ageText = String(ageNode?.text || "").trim();
  const likeText = String(likeNode?.text || "").trim();
  const author = String(authorNode?.text || "").trim();
  const ageDays = parseAgeDays(ageText, referenceDate, timeZone);

  return {
    id: hashText(`${headline}|${author}|${ageText}`),
    keyword,
    page: pageNumber,
    headline,
    snippet,
    rawText: bodyText,
    author,
    ageText,
    ageDays,
    likeText,
    likeCount: normalizeLikeCount(likeText),
    bounds: cardNode.bounds
  };
}

function extractSamplesFromXml(xml, options = {}) {
  const nodes = parseUiXml(xml);
  const cards = candidateCards(nodes);
  return cards
    .map((card) =>
      extractCard(
        nodes,
        card,
        options.keyword || DEFAULTS.studyKeyword,
        options.pageNumber || 1,
        options.referenceDate || new Date(),
        options.timeZone || DEFAULTS.timezone
      )
    )
    .filter(Boolean);
}

function rankRecentSamples(samples, windowDays) {
  return samples
    .filter((sample) => sample.ageDays !== null && sample.ageDays <= windowDays)
    .sort((left, right) => {
      if (right.likeCount !== left.likeCount) {
        return right.likeCount - left.likeCount;
      }
      return (left.ageDays ?? 99) - (right.ageDays ?? 99);
    });
}

function styleScore(samples) {
  const scores = Object.fromEntries(STYLE_RULES.map((rule) => [rule.key, 0]));
  const combined = samples.map((sample) => `${sample.headline} ${sample.snippet}`.trim());

  for (const text of combined) {
    for (const rule of STYLE_RULES) {
      if (rule.pattern.test(text)) {
        scores[rule.key] += 1;
      }
    }
  }

  return scores;
}

function topKeywords(samples) {
  return KEY_PHRASES.map((phrase) => ({
    phrase,
    count: samples.filter((sample) => `${sample.headline} ${sample.snippet}`.includes(phrase)).length
  }))
    .filter((item) => item.count > 0)
    .sort((left, right) => right.count - left.count)
    .slice(0, 6)
    .map((item) => item.phrase);
}

function titleRulesFromScores(scores) {
  const rules = [
    "标题先从 OpenClaw 的卡点、判断或结果切入，不要从 repo 名开头。",
    "优先用真人口吻，像“我先试了”“先别急着”“真正卡点在…”。"
  ];

  if ((scores.listicle || 0) > 0) {
    rules.push("能清单化就清单化，优先 3 个场景 / 3 个步骤 / 15 个玩法 这种结构。");
  }

  if ((scores.metaphor || 0) > 0) {
    rules.push("把 OpenClaw 翻译成生活化比喻，再讲应用，不要直接堆术语。");
  }

  return rules.slice(0, 3);
}

function coverRulesFromScores(scores) {
  const rules = [
    "封面优先像笔记截图、清单卡或流程卡，不要 repo 卡片风。",
    "首屏最多一个主句，一个副句，信息层级清楚，不要整页海报。"
  ];

  if ((scores.listicle || 0) > 0) {
    rules.push("清单类热帖更吃香，封面优先做“3 个场景 / 15 个玩法”这种攻略卡。");
  } else if ((scores.judgment || 0) > 0) {
    rules.push("判断类热帖更有效，封面主句优先做“先别碰 / 别急着 / 问题不在…”。");
  }

  return rules.slice(0, 3);
}

function bodyRulesFromScores(scores) {
  const rules = [
    "开头第一句先说自己为什么最近在折腾 OpenClaw，以及卡在哪。",
    "中段用 1.2.3 讲真实应用、配置顺序或判断标准。",
    "结尾给互动口令，优先“配置 / 继续 / 场景 / 命令流”。"
  ];

  if ((scores.persona || 0) > 0) {
    rules.unshift("先立一个轻人设，再讲工具：普通人 / 产品经理 / 懒人视角都比说明书更有效。");
  }

  return rules.slice(0, 4);
}

function preferredCoverStyle(scores) {
  if ((scores.listicle || 0) >= Math.max(scores.judgment || 0, scores.application || 0)) {
    return "note-list";
  }

  if ((scores.metaphor || 0) > 0) {
    return "quote-note";
  }

  return "experience-note";
}

function primaryHooks(scores) {
  return STYLE_RULES.map((rule) => ({
    key: rule.key,
    label: rule.label,
    score: scores[rule.key] || 0
  }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 3);
}

function coverHookFromSamples(samples) {
  const top = samples[0];
  if (!top) {
    return "OpenClaw 到底怎么用";
  }

  if (/先别|听劝/.test(top.headline)) {
    return "普通人先别急着上重配置";
  }

  if (/玩法|场景/.test(top.headline)) {
    return "先看能落地的 3 个场景";
  }

  if (/批奏折|龙虾/.test(top.headline)) {
    return "先把 OpenClaw 讲成人话";
  }

  return "OpenClaw 先从实战场景讲";
}

function coverSupportFromSamples(samples) {
  const texts = samples.map((sample) => sample.headline).join(" ");

  if (/普通人|产品经理/.test(texts)) {
    return "先讲谁在用\n再讲为什么值";
  }

  if (/玩法|场景/.test(texts)) {
    return "不是概念解释\n是今天就能试";
  }

  return "先说卡点\n再给真实应用";
}

function coverChipsFromKeywords(keywords) {
  const fallback = ["场景", "配置", "应用", "收口"];
  return [...new Set((keywords.length > 0 ? keywords : fallback).slice(0, 4))];
}

function buildPromptContext(study, brief = study.brief || {}) {
  const sampleLines = (study.recentHotSamples || []).slice(0, 4).map((sample, index) => {
    return `${index + 1}. ${sample.headline}（${sample.ageText || "未知时间"}，${sample.likeText || "0"}赞）`;
  });

  return [
    `近 ${study.windowDays} 天小红书「${study.keyword}」热帖学习结果：`,
    sampleLines.length > 0 ? sampleLines.join("\n") : "- 暂无最近样本，沿用历史经验。",
    `当前有效钩子：${(brief.primaryHooks || []).join("、") || "判断句、清单句、实战应用"}`,
    `标题规则：${(brief.titleRules || []).join(" / ")}`,
    `封面规则：${(brief.coverRules || []).join(" / ")}`,
    `正文规则：${(brief.bodyRules || []).join(" / ")}`,
    "只学结构和节奏，不要照抄原句。"
  ].join("\n");
}

function buildTrendBrief(keyword, recentHotSamples) {
  const scores = styleScore(recentHotSamples);
  const hooks = primaryHooks(scores);
  const keywords = topKeywords(recentHotSamples);

  return {
    primaryHooks: hooks.map((item) => item.label),
    primaryHookKey: hooks[0]?.key || "application",
    topKeywords: keywords,
    titleRules: titleRulesFromScores(scores),
    coverRules: coverRulesFromScores(scores),
    bodyRules: bodyRulesFromScores(scores),
    coverStyle: preferredCoverStyle(scores),
    coverHook: coverHookFromSamples(recentHotSamples),
    coverSupport: coverSupportFromSamples(recentHotSamples),
    coverChips: coverChipsFromKeywords(keywords),
    note: `学的是「${keyword}」近三天热帖结构，不是复刻原文。`
  };
}

function latestStudy(keyword) {
  if (!fileExists(STUDY_DIR)) {
    return null;
  }

  const keywordSlug = slugify(keyword);
  const dayDirs = readdirSync(STUDY_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();

  for (const dayDir of dayDirs) {
    const candidatePath = `${STUDY_DIR}/${dayDir}/${keywordSlug}.json`;
    if (fileExists(candidatePath)) {
      return readJson(candidatePath, null);
    }
  }

  return null;
}

async function captureSearchStudy(options = {}) {
  const keyword = options.keyword || DEFAULTS.studyKeyword;
  const timeZone = options.timeZone || DEFAULTS.timezone;
  const dayKeyValue = options.date || dateKey(new Date(), timeZone);
  const outputDir = options.outputDir || artifactsDir(dayKeyValue, keyword);

  ensureDir(outputDir);
  openDeepLink(resultRoute(keyword));
  await sleep(2200);

  const pages = [];
  const allSamples = [];
  const referenceDate = new Date();

  for (let index = 0; index < (options.pages || DEFAULTS.studyPages); index += 1) {
    const pageNumber = index + 1;
    const baseName = `page-${pageNumber}`;
    const pngPath = `${outputDir}/${baseName}.png`;
    const xmlPath = `${outputDir}/${baseName}.xml`;

    screenshot(pngPath);
    dumpUiXml(xmlPath);

    const xml = readFileSync(resolve(xmlPath), "utf8");
    const samples = extractSamplesFromXml(xml, {
      keyword,
      pageNumber,
      referenceDate,
      timeZone
    });

    pages.push({
      page: pageNumber,
      pngPath,
      xmlPath,
      sampleCount: samples.length
    });
    allSamples.push(...samples);

    if (pageNumber < (options.pages || DEFAULTS.studyPages)) {
      swipe(540, 2050, 540, 960, 260);
      await sleep(1800);
    }
  }

  const samples = uniqueBy(allSamples, (sample) => sample.id).slice(0, DEFAULTS.studyMaxSamples);
  const recentHotSamples = rankRecentSamples(samples, options.windowDays || DEFAULTS.studyWindowDays);
  const brief = buildTrendBrief(keyword, recentHotSamples);

  return {
    keyword,
    dayKey: dayKeyValue,
    windowDays: options.windowDays || DEFAULTS.studyWindowDays,
    capturedAt: nowIso(),
    route: resultRoute(keyword),
    pages,
    samples,
    recentHotSamples: recentHotSamples.slice(0, 8),
    brief
  };
}

export function formatTrendStudyForPrompt(study) {
  return study ? buildPromptContext(study) : "";
}

export async function ensureTrendStudy(options = {}) {
  const keyword = options.keyword || DEFAULTS.studyKeyword;
  const timeZone = options.timeZone || DEFAULTS.timezone;
  const dayKeyValue = options.date || dateKey(new Date(), timeZone);
  const targetPath = studyPath(dayKeyValue, keyword);

  if (!options.force && fileExists(targetPath)) {
    return readJson(targetPath, null);
  }

  if (options.offline) {
    return readJson(targetPath, null) || latestStudy(keyword);
  }

  try {
    const study = await captureSearchStudy({
      ...options,
      keyword,
      timeZone,
      date: dayKeyValue
    });
    const withContext = {
      ...study,
      brief: {
        ...study.brief
      }
    };
    withContext.brief.promptContext = buildPromptContext(withContext, withContext.brief);

    writeJson(targetPath, withContext);
    writeText(
      `${studyDayDir(dayKeyValue)}/${slugify(keyword)}.md`,
      `# ${keyword} 热帖学习\n\n${withContext.brief.promptContext}\n`
    );
    return withContext;
  } catch (error) {
    const fallback = latestStudy(keyword);
    if (fallback) {
      return fallback;
    }
    throw error;
  }
}

function parseArgs(argv) {
  return {
    keyword: argv.includes("--keyword")
      ? argv[argv.indexOf("--keyword") + 1]
      : DEFAULTS.studyKeyword,
    date: argv.includes("--date")
      ? argv[argv.indexOf("--date") + 1]
      : undefined,
    timeZone: argv.includes("--timezone")
      ? argv[argv.indexOf("--timezone") + 1]
      : DEFAULTS.timezone,
    force: argv.includes("--force"),
    offline: argv.includes("--offline"),
    fromXml: argv.includes("--from-xml")
      ? resolve(argv[argv.indexOf("--from-xml") + 1])
      : null
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.fromXml) {
    const xml = readFileSync(args.fromXml, "utf8");
    const samples = extractSamplesFromXml(xml, {
      keyword: args.keyword,
      pageNumber: 1,
      referenceDate: new Date(),
      timeZone: args.timeZone
    });
    const recentHotSamples = rankRecentSamples(samples, DEFAULTS.studyWindowDays);
    const study = {
      keyword: args.keyword,
      dayKey: args.date || dateKey(new Date(), args.timeZone),
      windowDays: DEFAULTS.studyWindowDays,
      capturedAt: nowIso(),
      route: "fixture",
      pages: [{ page: 1, xmlPath: args.fromXml, sampleCount: samples.length }],
      samples,
      recentHotSamples,
      brief: {}
    };
    study.brief = {
      ...buildTrendBrief(args.keyword, recentHotSamples)
    };
    study.brief.promptContext = buildPromptContext(study, study.brief);
    console.log(JSON.stringify(study, null, 2));
    return;
  }

  const study = await ensureTrendStudy(args);
  console.log(JSON.stringify(study, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
