import { clip } from "./utils.mjs";
import { remoteTextRefine } from "./remote-openclaw.mjs";
import { geminiGeneratePost, geminiGenerateReply } from "./gemini.mjs";
import { formatTrendStudyForPrompt } from "./study-xhs.mjs";
import {
  buildOpsDraft,
  buildOpsRefinePrompt,
  normalizeHashtagString,
  sanitizeOpsText
} from "./xhs-ops.mjs";
import { reviewPostPackage } from "./post-preflight.mjs";

function composeBody(body, hashtags) {
  const cleanBody = String(body || "").replace(/\n?#\S.*$/s, "").trim();
  const cleanTags = normalizeHashtagString(hashtags);
  return cleanTags ? `${cleanBody}\n\n${cleanTags}` : cleanBody;
}

function normalizeCommentInput(commentInput, context = {}) {
  if (typeof commentInput === "string") {
    return {
      commentText: commentInput,
      ...context
    };
  }

  return {
    ...(commentInput || {}),
    ...context
  };
}

function finalizePostPackage(postPackage) {
  const hashtags = normalizeHashtagString(postPackage.hashtags || "");
  const body = composeBody(postPackage.body, hashtags);
  return {
    ...postPackage,
    title: clip(sanitizeOpsText(postPackage.title || ""), 22),
    body: sanitizeOpsText(body),
    hashtags,
    commentSeed: sanitizeOpsText(postPackage.commentSeed || "")
  };
}

export async function buildPostPackage(repo, options = {}) {
  const trendStudy = options.trendStudy || null;
  const baseDraft = buildOpsDraft(repo, trendStudy?.brief || null);
  const refinedLocalBody = remoteTextRefine(
    buildOpsRefinePrompt(repo, baseDraft, trendStudy?.brief || null),
    baseDraft.body
  );

  const localPackage = finalizePostPackage({
    ...baseDraft,
    body: refinedLocalBody || baseDraft.body,
    repo,
    study: trendStudy
      ? {
          keyword: trendStudy.keyword,
          promptContext: formatTrendStudyForPrompt(trendStudy),
          brief: trendStudy.brief,
          samples: (trendStudy.recentHotSamples || []).slice(0, 4)
        }
      : null,
    provider: {
      type: "local"
    }
  });

  try {
    const geminiPackage = await geminiGeneratePost(repo, localPackage, trendStudy);
    if (geminiPackage?.title && geminiPackage?.body) {
      const candidate = finalizePostPackage({
        ...localPackage,
        title: geminiPackage.title,
        body: geminiPackage.body,
        hashtags: geminiPackage.hashtags || localPackage.hashtags,
        commentSeed: geminiPackage.commentSeed || localPackage.commentSeed,
        ops: {
          ...localPackage.ops,
          coverPlan: {
            ...localPackage.ops.coverPlan,
            ...(geminiPackage.coverPlan || {})
          }
        },
        provider: geminiPackage.provider
      });

      const review = reviewPostPackage(candidate);
      if (review.ok) {
        return {
          ...candidate,
          review
        };
      }
    }
  } catch {}

  return {
    ...localPackage,
    review: reviewPostPackage(localPackage)
  };
}

export function classifyComment(text, context = {}) {
  const historyText = (context.history || []).map((item) => item.text || "").join("\n");
  const previousContextText = [context.previousContextText || "", historyText].join("\n");

  if (/(皇帝|土皇帝|批奏折|三省六部|像.*皇帝|当上.*皇帝|哈哈|hhh|hh)/i.test(text)) {
    return "analogy";
  }

  if (
    /(谢谢|感谢|太需要|非常需要|正需要|求你了)/.test(text) &&
    /(google|谷歌|googleapis|dns|443|防火墙|服务器|海外|区域|网络)/i.test(previousContextText)
  ) {
    return "followup-server";
  }

  if (/(怎么|如何|能不能|可以吗|\?|？)/.test(text)) {
    return "question";
  }

  if (/(地址|链接|github|仓库)/i.test(text)) {
    return "link";
  }

  if (/(谢谢|收藏|有用|学到)/.test(text)) {
    return "thanks";
  }

  return "general";
}

export function isSafeForAutoReply(text) {
  if (!text || text.length < 2) return false;
  if (/(政治|违法|博彩|色情|代写|破解|翻墙|灰产)/.test(text)) return false;
  return true;
}

export async function buildReplyDraft(commentInput, postPackage, context = {}) {
  const entry = normalizeCommentInput(commentInput, context);
  const commentText = entry.commentText || "";
  const kind = classifyComment(commentText, entry);
  const repoName = postPackage.repo.name;
  let fallbackReply = "我也在继续实测这条链路，后面会把更具体的接法补上。";

  if (kind === "analogy") {
    fallbackReply = "哈哈哈，对，就是这个意思。接上三省六部以后，发号的人更像皇帝，下面先审再办，流程就不乱了。";
  } else if (kind === "followup-server") {
    fallbackReply = "你先看是 GCP、AWS 还是国内云，再测两步：DNS 能不能解析 googleapis，443 出站能不能通。如果这两步都不通，优先换区域或出口网络。";
  } else if (kind === "link") {
    fallbackReply = `仓库名是 ${repoName}，你直接搜 ${postPackage.repo.fullName} 就能找到。我下一条也会把接 OpenClaw 的思路补出来。`;
  } else if (kind === "question") {
    fallbackReply = `可以的。这个项目我更建议先看输入输出，再决定怎么接进 OpenClaw。你如果想看具体命令流，我下一篇直接拆。`;
  } else if (kind === "thanks") {
    fallbackReply = "收到，我会继续按这种“热门项目 + 实际接法”的方式更新。";
  }

  try {
    const geminiReply = await geminiGenerateReply(
      commentText,
      fallbackReply,
      postPackage,
      {
        authorName: entry.authorName || "",
        interactionType: entry.interactionType || "",
        previousContextText: entry.previousContextText || "",
        history: entry.history || []
      }
    );
    if (geminiReply) {
      return sanitizeOpsText(geminiReply);
    }
  } catch {}

  return fallbackReply;
}
