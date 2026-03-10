import { STATE_DIR } from "./config.mjs";
import { hashText, nowIso, readJson, writeJson } from "./utils.mjs";

const STATE_PATH = `${STATE_DIR}/runtime.json`;

function baseState() {
  return {
    posts: {},
    replies: {},
    commentThreads: {},
    commentFingerprints: {},
    lastCommentSweepAt: null,
    providers: {
      gemini: {
        nextKeyIndex: 0,
        lastErrorAt: null,
        lastErrorCode: null
      }
    }
  };
}

export function loadState() {
  const state = readJson(STATE_PATH, baseState()) || baseState();
  state.posts ||= {};
  state.replies ||= {};
  state.commentThreads ||= {};
  state.commentFingerprints ||= {};
  state.providers ||= {};
  state.providers.gemini ||= {
    nextKeyIndex: 0,
    lastErrorAt: null,
    lastErrorCode: null
  };

  for (const [replyKey, reply] of Object.entries(state.replies)) {
    const fingerprint =
      reply.commentFingerprint ||
      buildCommentFingerprint({
        authorName: reply.authorName,
        commentText: reply.commentText,
        interactionType: reply.interactionType,
        previousContextText: reply.previousContextText
      });

    state.replies[replyKey].commentFingerprint = fingerprint;
    state.commentFingerprints[fingerprint] ||= {
      at: reply.at || nowIso(),
      authorName: reply.authorName || "",
      commentText: reply.commentText || "",
      interactionType: reply.interactionType || "",
      threadKey: reply.threadKey || ""
    };
  }

  return state;
}

export function saveState(state) {
  writeJson(STATE_PATH, state);
}

export function buildCommentThreadKey(seed) {
  return `thread-${hashText(seed)}`;
}

function normalizeCommentMeta(commentMeta, threadKey = null) {
  if (typeof commentMeta === "string") {
    return {
      commentText: commentMeta,
      threadKey
    };
  }

  return {
    ...(commentMeta || {}),
    ...(threadKey ? { threadKey } : {})
  };
}

export function buildCommentFingerprint(commentMeta, threadKey = null) {
  const meta = normalizeCommentMeta(commentMeta, threadKey);
  const parts = [
    meta.authorName || "",
    meta.commentText || "",
    meta.interactionType || "",
    meta.previousContextText || ""
  ];

  return `comment-${hashText(parts.join("|"))}`;
}

export function hasPosted(state, dayKey) {
  return Boolean(state.posts?.[dayKey]);
}

export function markPosted(state, dayKey, metadata = {}) {
  state.posts[dayKey] = {
    at: nowIso(),
    ...metadata
  };
  saveState(state);
}

export function hasReplied(state, replyKey) {
  return Boolean(state.replies?.[replyKey]);
}

export function hasRepliedToComment(state, commentMeta, threadKey = null) {
  const meta = normalizeCommentMeta(commentMeta, threadKey);
  const fingerprint = meta.commentFingerprint || buildCommentFingerprint(meta);

  if (state.commentFingerprints?.[fingerprint]) {
    return true;
  }

  return Object.values(state.replies || {}).some(
    (reply) =>
      reply.commentText === meta.commentText &&
      (!meta.authorName || !reply.authorName || reply.authorName === meta.authorName) &&
      (!meta.threadKey || !reply.threadKey || reply.threadKey === meta.threadKey)
  );
}

export function findReplyByText(state, replyText) {
  return (
    Object.values(state.replies || {}).find(
      (reply) => String(reply.replyText || "").trim() === String(replyText || "").trim()
    ) || null
  );
}

export function getThreadMessages(state, threadKey) {
  return state.commentThreads?.[threadKey]?.messages || [];
}

function appendThreadMessage(state, threadKey, threadMeta, message) {
  if (!threadKey || !message?.text) {
    return;
  }

  state.commentThreads ||= {};
  state.commentThreads[threadKey] ||= {
    authorName: threadMeta.authorName || "",
    sourcePostTitle: threadMeta.sourcePostTitle || "",
    messages: []
  };

  const thread = state.commentThreads[threadKey];
  if (!thread.authorName && threadMeta.authorName) {
    thread.authorName = threadMeta.authorName;
  }
  if (!thread.sourcePostTitle && threadMeta.sourcePostTitle) {
    thread.sourcePostTitle = threadMeta.sourcePostTitle;
  }

  const exists = thread.messages.some(
    (item) =>
      item.role === message.role &&
      item.text === message.text &&
      item.interactionType === message.interactionType
  );

  if (!exists) {
    thread.messages.push({
      at: message.at || nowIso(),
      role: message.role,
      text: message.text,
      interactionType: message.interactionType || ""
    });
  }
}

export function markReplied(state, replyKey, metadata = {}) {
  const fingerprint =
    metadata.commentFingerprint ||
    buildCommentFingerprint({
      authorName: metadata.authorName,
      commentText: metadata.commentText,
      interactionType: metadata.interactionType,
      previousContextText: metadata.previousContextText
    });

  state.replies[replyKey] = {
    at: nowIso(),
    commentFingerprint: fingerprint,
    ...metadata
  };

  state.commentFingerprints[fingerprint] = {
    at: nowIso(),
    authorName: metadata.authorName || "",
    commentText: metadata.commentText || "",
    interactionType: metadata.interactionType || "",
    threadKey: metadata.threadKey || ""
  };

  if (metadata.threadKey) {
    appendThreadMessage(
      state,
      metadata.threadKey,
      {
        authorName: metadata.authorName,
        sourcePostTitle: metadata.sourcePostTitle
      },
      {
        role: "user",
        text: metadata.commentText,
        interactionType: metadata.interactionType,
        at: metadata.commentAt || metadata.at
      }
    );

    appendThreadMessage(
      state,
      metadata.threadKey,
      {
        authorName: metadata.authorName,
        sourcePostTitle: metadata.sourcePostTitle
      },
      {
        role: "assistant",
        text: metadata.replyText,
        interactionType: "reply",
        at: metadata.at
      }
    );
  }

  saveState(state);
}

export function updateCommentSweep(state) {
  state.lastCommentSweepAt = nowIso();
  saveState(state);
}

export function getGeminiRotationState(state) {
  state.providers ||= {};
  state.providers.gemini ||= {
    nextKeyIndex: 0,
    lastErrorAt: null,
    lastErrorCode: null
  };
  return state.providers.gemini;
}

export function updateGeminiRotation(state, metadata = {}) {
  const gemini = getGeminiRotationState(state);
  if (typeof metadata.nextKeyIndex === "number") {
    gemini.nextKeyIndex = metadata.nextKeyIndex;
  }
  if (Object.prototype.hasOwnProperty.call(metadata, "lastErrorAt")) {
    gemini.lastErrorAt = metadata.lastErrorAt;
  }
  if (Object.prototype.hasOwnProperty.call(metadata, "lastErrorCode")) {
    gemini.lastErrorCode = metadata.lastErrorCode;
  }
  saveState(state);
}
