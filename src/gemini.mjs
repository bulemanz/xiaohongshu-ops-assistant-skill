import { spawnSync } from "node:child_process";
import { GEMINI } from "./config.mjs";
import { REMOTE } from "./config.mjs";
import { formatTrendStudyForPrompt } from "./study-xhs.mjs";
import {
  getGeminiRotationState,
  loadState,
  updateGeminiRotation
} from "./state.mjs";

function geminiUrl(apiVersion, model) {
  return `https://generativelanguage.googleapis.com/${apiVersion}/models/${model}:generateContent`;
}

function isRetryableStatus(status) {
  return [401, 403, 429, 500, 502, 503, 504].includes(status);
}

function extractErrorCode(payload, fallback) {
  return payload?.error?.status || payload?.error?.code || fallback || "UNKNOWN";
}

function extractErrorMessage(payload) {
  return payload?.error?.message || "";
}

function shouldTryRemote(detail) {
  return /location is not supported/i.test(detail || "");
}

function callGeminiRemote({ apiVersion, model, body, apiKey }) {
  const payloadB64 = Buffer.from(JSON.stringify(body), "utf8").toString("base64");
  const url = geminiUrl(apiVersion, model);
  const remoteCommand = [
    `PAYLOAD_B64='${payloadB64}'`,
    `TMP_JSON=/tmp/xhs_gemini_${Date.now()}.json`,
    `printf '%s' "$PAYLOAD_B64" | base64 -d > "$TMP_JSON"`,
    `curl -sS -X POST '${url}' -H 'Content-Type: application/json' -H 'x-goog-api-key: ${apiKey}' --data @"$TMP_JSON" -w '\\nHTTP_STATUS:%{http_code}\\n'`
  ].join(" && ");

  const result = spawnSync(
    "gcloud",
    [
      "compute",
      "ssh",
      "--zone",
      REMOTE.zone,
      REMOTE.instance,
      "--project",
      REMOTE.project,
      "--command",
      remoteCommand
    ],
    {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024
    }
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "remote Gemini request failed").trim());
  }

  const output = (result.stdout || "").trim();
  const marker = "\nHTTP_STATUS:";
  const markerIndex = output.lastIndexOf(marker);
  const payloadText = markerIndex >= 0 ? output.slice(0, markerIndex) : output;
  const status = markerIndex >= 0 ? Number(output.slice(markerIndex + marker.length).trim()) : 0;
  let payload = null;

  try {
    payload = JSON.parse(payloadText);
  } catch {
    payload = null;
  }

  return {
    ok: status >= 200 && status < 300,
    status,
    payload
  };
}

function normalizeTextResponse(payload) {
  const candidates = payload?.candidates || [];
  for (const candidate of candidates) {
    const parts = candidate?.content?.parts || [];
    const text = parts
      .map((part) => part?.text || "")
      .join("")
      .trim();
    if (text) {
      return text;
    }
  }
  return "";
}

function normalizeImageResponse(payload) {
  const candidates = payload?.candidates || [];
  for (const candidate of candidates) {
    const parts = candidate?.content?.parts || [];
    for (const part of parts) {
      const data = part?.inlineData?.data || part?.inline_data?.data;
      if (data) {
        return data;
      }
    }
  }
  return null;
}

function parseLooseJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]+?)```/i);
  const source = fenced ? fenced[1] : text;
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start < 0 || end < 0 || end <= start) {
    throw new Error("Gemini did not return JSON");
  }

  return JSON.parse(source.slice(start, end + 1));
}

async function callGeminiWithRotation({
  kind,
  apiVersion,
  model,
  body,
  normalize
}) {
  if (!GEMINI.enabled || GEMINI.keys.length === 0) {
    return { ok: false, value: null, reason: "disabled" };
  }

  const state = loadState();
  const rotation = getGeminiRotationState(state);
  const keys = GEMINI.keys;
  const startIndex = rotation.nextKeyIndex % keys.length;
  let lastError = null;

  for (let offset = 0; offset < keys.length; offset += 1) {
    const index = (startIndex + offset) % keys.length;
    const apiKey = keys[index];
    let status = 0;
    let payload = null;

    if (GEMINI.transport !== "gcloud") {
      const response = await fetch(geminiUrl(apiVersion, model), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify(body)
      });

      status = response.status;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
    }

    const localDetail = extractErrorMessage(payload);

    if (
      (GEMINI.transport === "gcloud" ||
        (GEMINI.transport === "auto" && shouldTryRemote(localDetail))) &&
      GEMINI.remoteViaGcloud
    ) {
      const remote = callGeminiRemote({
        apiVersion,
        model,
        body,
        apiKey
      });
      status = remote.status;
      payload = remote.payload;
    }

    if (status >= 200 && status < 300) {
      updateGeminiRotation(state, {
        nextKeyIndex: (index + 1) % keys.length,
        lastErrorAt: null,
        lastErrorCode: null
      });
      return {
        ok: true,
        value: normalize(payload),
        meta: { kind, model, keyIndex: index }
      };
    }

    const code = extractErrorCode(payload, String(status));
    const detail = extractErrorMessage(payload) || localDetail;
    lastError = new Error(
      `${kind} request failed on ${model}: ${status} ${code}${detail ? ` - ${detail}` : ""}`
    );

    if (!isRetryableStatus(status)) {
      updateGeminiRotation(state, {
        nextKeyIndex: index,
        lastErrorAt: new Date().toISOString(),
        lastErrorCode: code
      });
      break;
    }

    updateGeminiRotation(state, {
      nextKeyIndex: (index + 1) % keys.length,
      lastErrorAt: new Date().toISOString(),
      lastErrorCode: code
    });
  }

  if (lastError) {
    throw lastError;
  }

  return { ok: false, value: null, reason: "unknown" };
}

async function callGeminiAcrossModels({
  kind,
  apiVersion,
  models,
  body,
  normalize
}) {
  let lastError = null;

  for (const model of models) {
    try {
      const result = await callGeminiWithRotation({
        kind,
        apiVersion,
        model,
        body,
        normalize
      });

      if (result.ok) {
        return result;
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) {
    throw lastError;
  }

  return { ok: false, value: null, reason: "unknown" };
}

export async function geminiGeneratePost(repo, fallbackPackage, trendStudy = null) {
 const trendContext = formatTrendStudyForPrompt(trendStudy);
 const prompt = `
你是中文科技内容编辑。请根据给定仓库信息，生成一篇适合小红书图文笔记的内容方案。

硬性要求：
- 主题必须围绕 OpenClaw 与 GitHub 热门项目的实际用法
- 内容合法合规，不包含违法违规、夸张营销、收益承诺、平台规避、灰产、批量养号、绕审核等内容
- 风格自然、像真实创作者的经验分享，克制、具体、口语化
- 不要自称 AI，不要写“作为 AI”
- 标题不超过 22 个中文字符，像小红书图文标题，口语化，别像文档标题。可以有 0 到 1 个 Emoji，但不要堆 Emoji，不要营销词轰炸
- 标题必须直接出现 “OpenClaw”
- 标题优先用 痛点句 / 判断句 / “我先试了” 这 3 类之一
- 不要写“今日 GitHub 热门”“项目名：”“一句话看点：”“技术栈先记一下”
- 正文 220 到 420 个中文字符
- hashtags 3 到 6 个
- commentSeed 20 到 45 个中文字符，适合回复评论区置顶引导
- 额外输出 coverHook、coverSupport、coverChips，用于封面生成
- 输出严格为 JSON，不要加代码块，不要解释

风格参考：
- 结合小红书热门贴的风格，但整体要克制、像真人手写笔记
- 开头第一句必须先从 OpenClaw 切入，先说自己在试什么、卡在哪里
- 正文优先写真实判断、真实场景、真实取舍，不要像 repo 介绍卡
- 必须有一个 1.2.3 的清单，列出判断标准、落地步骤或使用场景
- 整体像一个朋友分享最近实测心得，不要用“绝绝子”“神器”“打工人必备”这类过重的口号
- 段落要非常短，一句一行，不要大段文字堆积！
- GitHub 热门项目是案例，OpenClaw 才是主线

JSON schema:
{
  "title": "string",
  "body": "string",
  "hashtags": ["#标签1", "#标签2"],
  "commentSeed": "string",
  "coverHook": "string",
  "coverSupport": "string",
  "coverChips": ["string", "string", "string"]
}

仓库信息：
- name: ${repo.name}
- fullName: ${repo.fullName}
- description: ${repo.description || "暂无描述"}
- language: ${repo.language || "Unknown"}
- url: ${repo.url}

本地草稿参考：
标题：${fallbackPackage.title}
正文：${fallbackPackage.body}
评论引导：${fallbackPackage.commentSeed}

${trendContext ? `近期热帖学习参考：\n${trendContext}\n` : ""}
`.trim();

  const result = await callGeminiAcrossModels({
    kind: "text",
    apiVersion: GEMINI.textApiVersion,
    models: GEMINI.textModels,
    body: {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json"
      }
    },
    normalize: normalizeTextResponse
  });

  if (!result.ok || !result.value) {
    return null;
  }

  const parsed = parseLooseJson(result.value);
  return {
    title: String(parsed.title || "").trim(),
    body: String(parsed.body || "").trim(),
    hashtags: Array.isArray(parsed.hashtags)
      ? parsed.hashtags.map((item) => String(item).trim()).filter(Boolean).join(" ")
      : String(parsed.hashtags || "").trim(),
    commentSeed: String(parsed.commentSeed || "").trim(),
    coverPlan: {
      highlight: String(parsed.coverHook || "").trim(),
      support: String(parsed.coverSupport || "").trim(),
      chips: Array.isArray(parsed.coverChips)
        ? parsed.coverChips.map((item) => String(item).trim()).filter(Boolean).slice(0, 4)
        : []
    },
    provider: {
      type: "gemini",
      model: result.meta?.model || GEMINI.textModels[0]
    }
  };
}

export async function geminiGenerateReply(commentText, fallbackReply, postPackage, replyContext = {}) {
  const historyText = (replyContext.history || [])
    .slice(-4)
    .map((item) => `${item.role === "assistant" ? "你上轮回复" : "对方上轮评论"}：${item.text}`)
    .join("\n");
  const prompt = `
你是中文科技内容创作者，请为一条小红书评论生成一条自然、克制、简短的回复。

要求：
- 合法合规
- 语气自然，不要营销腔
- 15 到 45 个中文字符
- 不要提 AI、模型、提示词
- 如果评论在要仓库信息，可以自然提到仓库名
- 先理解评论和当前笔记的关系，再决定怎么回复
- 如果评论是在接梗、玩比喻、调侃设定，优先顺着对方的语境接一句，再补一句点题解释
- 如果评论是在认同观点，不要误回成教程答疑
- 只输出回复正文

当前笔记标题：${postPackage.title}
当前笔记正文：${postPackage.body}
当前仓库：${postPackage.repo.fullName}
评论者昵称：${replyContext.authorName || "未知"}
互动类型：${replyContext.interactionType || "未知"}
上一轮上下文：${replyContext.previousContextText || "无"}
最近对话历史：
${historyText || "无"}
评论内容：${commentText}
本地候选回复：${fallbackReply}
`.trim();

  const result = await callGeminiAcrossModels({
    kind: "reply",
    apiVersion: GEMINI.textApiVersion,
    models: GEMINI.textModels,
    body: {
      contents: [{ parts: [{ text: prompt }] }]
    },
    normalize: normalizeTextResponse
  });

  return result.ok && result.value ? result.value.trim() : null;
}

export async function geminiGenerateImageBase64(prompt) {
  const result = await callGeminiAcrossModels({
    kind: "image",
    apiVersion: GEMINI.imageApiVersion,
    models: GEMINI.imageModels,
    body: {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: {
          aspectRatio: GEMINI.imageAspectRatio
        }
      }
    },
    normalize: normalizeImageResponse
  });

  return result.ok ? result.value : null;
}

export async function geminiProbeImagePayload(prompt) {
  return callGeminiAcrossModels({
    kind: "image",
    apiVersion: GEMINI.imageApiVersion,
    models: GEMINI.imageModels,
    body: {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: {
          aspectRatio: GEMINI.imageAspectRatio
        }
      }
    },
    normalize: (payload) => payload
  });
}
