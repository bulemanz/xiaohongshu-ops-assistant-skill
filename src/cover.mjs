import { renameSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { GENERATED_DIR } from "./config.mjs";
import {
  clip,
  escapeXml,
  ensureDir,
  hashText,
  slugify,
  wrapText,
  writeText
} from "./utils.mjs";
import { remoteImageBase64 } from "./remote-openclaw.mjs";
import { geminiGenerateImageBase64 } from "./gemini.mjs";

const PALETTES = [
  { bg: "#f2eadf", fg: "#161616", accent: "#d06d4b", line: "#c4b39d" },
  { bg: "#eaf1f4", fg: "#14213d", accent: "#f28f3b", line: "#8aa1b1" },
  { bg: "#f6f1ee", fg: "#202124", accent: "#2f7a5f", line: "#d1c7be" }
];

function buildDiagramBox({
  x,
  y,
  width,
  height,
  title,
  subtitle,
  fill = "#fffdf8",
  stroke = "#a9a29b",
  dash = "14 10",
  titleSize = 40,
  subtitleSize = 26
}) {
  const titleLines = wrapText(clip(title, 12), 8).slice(0, 2);
  const subtitleLines = wrapText(clip(subtitle, 18), 14).slice(0, 2);
  const centerX = x + width / 2;
  const titleStartY = y + 48;
  const subtitleStartY = y + 92 + Math.max(0, titleLines.length - 1) * 34;

  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="22" fill="${fill}" stroke="${stroke}" stroke-width="4" stroke-dasharray="${dash}"/>
  ${titleLines
    .map(
      (line, index) =>
        `<text x="${centerX}" y="${titleStartY + index * 40}" font-size="${titleSize}" font-weight="700" text-anchor="middle" font-family="PingFang SC, Hiragino Sans GB, Noto Sans CJK SC, sans-serif" fill="#161616">${escapeXml(
          line
        )}</text>`
    )
    .join("\n  ")}
  ${subtitleLines
    .map(
      (line, index) =>
        `<text x="${centerX}" y="${subtitleStartY + index * 30}" font-size="${subtitleSize}" font-weight="500" text-anchor="middle" font-family="PingFang SC, Hiragino Sans GB, Noto Sans CJK SC, sans-serif" fill="#5a5854">${escapeXml(
          line
        )}</text>`
    )
    .join("\n  ")}`;
}

function buildWorkflowDiagramSvg(postPackage) {
  const coverPlan = postPackage.ops?.coverPlan || {};
  const badge = clip(coverPlan.badge || "OpenClaw 工作流", 18);
  const noteLines = wrapText(clip(coverPlan.note || "复杂任务终于不再跑散", 18), 8).slice(0, 2);
  const footer = clip(coverPlan.footer || "不是多开 agent，是先有人批奏折", 28);
  const steps = Array.isArray(coverPlan.steps) && coverPlan.steps.length
    ? coverPlan.steps.slice(0, 4)
    : [
        { title: "S0 预筛选", subtitle: "小事直做 | 难事立项" },
        { title: "中书省", subtitle: "拆题 | 拟方案" },
        { title: "门下省", subtitle: "挑漏洞 | 查假设" },
        { title: "尚书省", subtitle: "派任务 | 收结果" }
      ];
  const departments = Array.isArray(coverPlan.departments) && coverPlan.departments.length
    ? coverPlan.departments.slice(0, 6)
    : [
        { title: "吏部", subtitle: "人手" },
        { title: "户部", subtitle: "数据" },
        { title: "礼部", subtitle: "文案" },
        { title: "兵部", subtitle: "代码" },
        { title: "刑部", subtitle: "风险" },
        { title: "工部", subtitle: "部署" }
      ];

  const stepBoxes = [];
  const arrows = [];
  const stepX = 250;
  const stepWidth = 700;
  const stepHeight = 106;
  const startY = 304;
  const gap = 56;

  for (let index = 0; index < steps.length; index += 1) {
    const y = startY + index * (stepHeight + gap);
    stepBoxes.push(
      buildDiagramBox({
        x: stepX,
        y,
        width: stepWidth,
        height: stepHeight,
        title: steps[index].title,
        subtitle: steps[index].subtitle
      })
    );

    if (index < steps.length - 1) {
      const fromY = y + stepHeight;
      const toY = y + stepHeight + gap;
      arrows.push(`<line x1="600" y1="${fromY + 12}" x2="600" y2="${toY - 18}" stroke="#8d877f" stroke-width="4"/>
  <polygon points="600,${toY - 4} 588,${toY - 26} 612,${toY - 26}" fill="#8d877f"/>`);
    }
  }

  const departmentBoxes = departments
    .map((item, index) => {
      const row = Math.floor(index / 3);
      const col = index % 3;
      const x = 118 + col * 324;
      const y = 1050 + row * 176;
      return buildDiagramBox({
        x,
        y,
        width: 280,
        height: 118,
        title: item.title,
        subtitle: item.subtitle,
        titleSize: 34,
        subtitleSize: 24
      });
    })
    .join("\n  ");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600" viewBox="0 0 1200 1600">
  <rect width="1200" height="1600" fill="#f6f3ee"/>
  <rect x="56" y="56" width="1088" height="1488" rx="36" fill="#fffdfa" stroke="#d9d1c8" stroke-width="4"/>
  <rect x="92" y="96" width="346" height="66" rx="20" fill="#181818"/>
  <text x="126" y="139" font-size="30" font-weight="700" font-family="PingFang SC, Hiragino Sans GB, Noto Sans CJK SC, sans-serif" fill="#fffdfa">${escapeXml(
    badge
  )}</text>
  <rect x="880" y="88" width="194" height="104" rx="18" fill="#f3e39b" stroke="#d6c57d" stroke-width="3" transform="rotate(-4 977 140)"/>
  ${noteLines
    .map(
      (line, index) =>
        `<text x="978" y="${132 + index * 34}" font-size="28" font-weight="700" text-anchor="middle" font-family="PingFang SC, Hiragino Sans GB, Noto Sans CJK SC, sans-serif" fill="#2c2925" transform="rotate(-4 978 140)">${escapeXml(
          line
        )}</text>`
    )
    .join("\n  ")}
  ${buildDiagramBox({
    x: 412,
    y: 192,
    width: 376,
    height: 84,
    title: "任务（你）",
    subtitle: "提问题 | 定目标",
    titleSize: 34,
    subtitleSize: 24
  })}
  <line x1="600" y1="276" x2="600" y2="334" stroke="#8d877f" stroke-width="4"/>
  <polygon points="600,350 588,324 612,324" fill="#8d877f"/>
  ${stepBoxes.join("\n  ")}
  ${arrows.join("\n  ")}
  <line x1="600" y1="834" x2="600" y2="898" stroke="#8d877f" stroke-width="4"/>
  <polygon points="600,914 588,888 612,888" fill="#8d877f"/>
  <text x="600" y="1002" font-size="34" font-weight="700" text-anchor="middle" font-family="PingFang SC, Hiragino Sans GB, Noto Sans CJK SC, sans-serif" fill="#161616">六部干实活</text>
  ${departmentBoxes}
  <text x="600" y="1494" font-size="34" font-weight="600" text-anchor="middle" font-family="PingFang SC, Hiragino Sans GB, Noto Sans CJK SC, sans-serif" fill="#5a5854">${escapeXml(
    footer
  )}</text>
</svg>`;
}

function buildSvg(postPackage) {
  if (postPackage.ops?.coverPlan?.style === "diagram-note") {
    return buildWorkflowDiagramSvg(postPackage);
  }

  const { title } = postPackage;
  const coverPlan = postPackage.ops?.coverPlan || {};
  const palette = PALETTES[hashText(title).charCodeAt(0) % PALETTES.length];
  const highlight = wrapText(clip(coverPlan.highlight || title, 18), 12).slice(0, 2);
  const headline = wrapText(clip(coverPlan.headline || title, 18), 8).slice(0, 3);
  const support = wrapText(clip(coverPlan.support || "先看它能不能进真实流程", 22), 12).slice(0, 2);
  const chips = (coverPlan.chips || []).slice(0, 4);
  const badge = clip(coverPlan.badge || "OpenClaw 亲测", 16);
  const ctaLabel = clip(coverPlan.ctaLabel || "我先这样试", 10);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600" viewBox="0 0 1200 1600">
  <rect width="1200" height="1600" fill="${palette.bg}"/>
  <rect x="56" y="56" width="1088" height="1488" rx="44" fill="#fffdf8" stroke="${palette.line}" stroke-width="4"/>
  <rect x="92" y="112" width="360" height="70" rx="22" fill="${palette.accent}"/>
  <text x="126" y="158" font-size="32" font-weight="700" font-family="PingFang SC, Hiragino Sans GB, Noto Sans CJK SC, sans-serif" fill="#fffdf8">${escapeXml(
    badge
  )}</text>
  <rect x="92" y="258" width="850" height="118" rx="26" fill="#f5e999"/>
  ${highlight
    .map(
      (line, index) =>
        `<text x="92" y="${332 + index * 96}" font-size="86" font-weight="800" font-family="PingFang SC, Hiragino Sans GB, Noto Sans CJK SC, sans-serif" fill="${palette.fg}">${escapeXml(
          line
        )}</text>`
    )
    .join("\n  ")}
  ${headline
    .map(
      (line, index) =>
        `<text x="92" y="${520 + index * 118}" font-size="102" font-weight="800" font-family="PingFang SC, Hiragino Sans GB, Noto Sans CJK SC, sans-serif" fill="${palette.fg}">${escapeXml(
          line
        )}</text>`
    )
    .join("\n  ")}
  <rect x="92" y="760" width="1016" height="126" rx="28" fill="#eef4ed"/>
  ${support
    .map(
      (line, index) =>
        `<text x="130" y="${826 + index * 58}" font-size="50" font-weight="600" font-family="PingFang SC, Hiragino Sans GB, Noto Sans CJK SC, sans-serif" fill="#2d6a4f">${escapeXml(
          line
        )}</text>`
    )
    .join("\n  ")}
  <rect x="92" y="970" width="320" height="88" rx="26" fill="#161616"/>
  <text x="130" y="1028" font-size="46" font-weight="700" font-family="PingFang SC, Hiragino Sans GB, Noto Sans CJK SC, sans-serif" fill="#fffdf8">${escapeXml(
    ctaLabel
  )}</text>
  ${chips
    .map((chip, index) => {
      const y = 1160 + index * 86;
      return `<circle cx="128" cy="${y}" r="12" fill="${palette.accent}"/>
  <text x="162" y="${y + 14}" font-size="44" font-family="PingFang SC, Hiragino Sans GB, Noto Sans CJK SC, sans-serif" fill="${palette.fg}">${escapeXml(
        chip
      )}</text>`;
    })
    .join("\n  ")}
  <text x="92" y="1510" font-size="30" font-family="PingFang SC, Hiragino Sans GB, Noto Sans CJK SC, sans-serif" fill="${palette.fg}" opacity="0.56">真实流程 &gt; 概念堆砌</text>
</svg>`;
}

function renderSvgToPng(svgPath, pngPath) {
  const result = spawnSync(
    "/usr/bin/qlmanage",
    ["-t", "-s", "1600", "-o", GENERATED_DIR, svgPath],
    {
      encoding: "utf8"
    }
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "qlmanage failed").trim());
  }

  renameSync(`${svgPath}.png`, pngPath);
}

export async function createCoverAssets(postPackage, dateKeyValue) {
  const slug = slugify(`${dateKeyValue}-${postPackage.repo.name}`);
  const basePath = `${GENERATED_DIR}/${slug}`;
  const svgPath = `${basePath}.svg`;
  const pngPath = `${basePath}.png`;
  ensureDir(GENERATED_DIR);
  const localFirst = postPackage.ops?.coverPlan?.style === "diagram-note";
  const trendContext = postPackage.study?.promptContext || "";

  if (localFirst) {
    const svg = buildSvg(postPackage);
    writeText(svgPath, svg);
    renderSvgToPng(svgPath, pngPath);
    return { svgPath, pngPath, mode: "local-svg" };
  }

  const geminiPng = await geminiGenerateImageBase64(
    `请生成一张适合中文科技图文平台的小红书封面，比例 ${"3:4"}，主题是“${postPackage.title}”。
要求：
- 画面像小红书高互动科技图文，不要 GitHub repo 卡片风
- 优先做真实使用感的流程图、截图感、清单卡片，不要整页铺满大字海报
- 必须有一个清晰主体，不要把全部信息都堆成 poster
- 背景偏浅色或暖白色，不要赛博霓虹，不要夸张特效
- 可以包含简洁工作台、终端、卡片、流程元素，但不要塞满 repo 信息
- 不要低俗、不夸张、不带营销词，不要 AI 海报感
- 适合 OpenClaw 实战内容分享，一眼看上去像“亲测笔记”
- 如果近期热帖更偏攻略卡、判断句或人设笔记，请优先学这种封面结构，不要做传统技术 poster
- 热帖学习参考：
${trendContext || "暂无当日热帖简报，按亲测笔记风生成。"}
- 只输出图片`
  ).catch(() => null);

  if (geminiPng) {
    writeFileSync(pngPath, Buffer.from(geminiPng, "base64"));
    return { svgPath: null, pngPath, mode: "gemini" };
  }

  const remotePng = remoteImageBase64(
    `请生成一张适合中文科技图文平台的封面图，主题是“${postPackage.title}”，要求包含痛点句、副句和场景 chips，像小红书开发者亲测笔记，不要 repo 卡片风。`
  );

  if (remotePng) {
    writeFileSync(pngPath, Buffer.from(remotePng, "base64"));
    return { svgPath: null, pngPath, mode: "remote" };
  }

  const svg = buildSvg(postPackage);

  writeText(svgPath, svg);
  renderSvgToPng(svgPath, pngPath);
  return { svgPath, pngPath, mode: "local-svg" };
}
