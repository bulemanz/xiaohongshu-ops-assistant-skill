import { normalizeHashtagString } from "./xhs-ops.mjs";

const TITLE_BAD_PATTERNS = [/今日\s*GitHub\s*热门/i, /OpenClaw\s*选题/i];
const BODY_BAD_PATTERNS = [/项目名：/, /一句话看点：/, /技术栈先记一下/];

export function reviewPostPackage(postPackage) {
  const errors = [];
  const warnings = [];
  const title = String(postPackage.title || "").trim();
  const body = String(postPackage.body || "").trim();
  const hashtags = normalizeHashtagString(postPackage.hashtags || "");
  const lines = body.split("\n").map((line) => line.trim()).filter(Boolean);

  if (!title) {
    errors.push("标题为空");
  }

  if (title.length < 10) {
    warnings.push("标题偏短，点击欲可能不够");
  }

  if (title.length > 22) {
    warnings.push("标题偏长，首屏可能挤压");
  }

  if (!/OpenClaw/.test(title)) {
    warnings.push("标题里没有 OpenClaw，主线可能不够清楚");
  }

  if (!/[？?]|先|我/.test(title)) {
    warnings.push("标题缺少问题感或第一人称判断");
  }

  for (const pattern of TITLE_BAD_PATTERNS) {
    if (pattern.test(title)) {
      errors.push("标题还像 repo 通知，不像平台内容");
      break;
    }
  }

  for (const pattern of BODY_BAD_PATTERNS) {
    if (pattern.test(body)) {
      errors.push("正文还带说明书口吻");
      break;
    }
  }

  if (lines.length < 7) {
    warnings.push("正文层次偏少，像一段说明而不是笔记");
  }

  if (!/评论区留|我下一条|如果你想看/.test(body)) {
    warnings.push("正文缺少互动口令");
  }

  if (!/(GitHub|技能页|参考链接)：https?:\/\//.test(body)) {
    warnings.push("正文缺少参考链接行");
  }

  const tagCount = hashtags ? hashtags.split(/\s+/).filter(Boolean).length : 0;
  if (tagCount < 3 || tagCount > 6) {
    warnings.push("标签数量不在 3 到 6 之间");
  }

  const coverPlan = postPackage.ops?.coverPlan || {};
  if (coverPlan.style === "diagram-note") {
    if (!Array.isArray(coverPlan.steps) || coverPlan.steps.length < 3) {
      warnings.push("流程图封面步骤不完整");
    }

    if (!Array.isArray(coverPlan.departments) || coverPlan.departments.length < 4) {
      warnings.push("流程图封面分工区块偏少");
    }
  } else if (!coverPlan.highlight || !coverPlan.headline) {
    warnings.push("封面文案层级不完整");
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings
  };
}
