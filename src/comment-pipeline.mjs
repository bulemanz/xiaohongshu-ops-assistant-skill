import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import { COMMENTS_DIR, DEFAULTS, LOCKS_DIR } from "./config.mjs";
import { ensureDailyPackage } from "./daily-package.mjs";
import {
  buildReplyDraft,
  isSafeForAutoReply
} from "./content.mjs";
import {
  buildCommentFingerprint,
  buildCommentThreadKey,
  findReplyByText,
  getThreadMessages,
  hasReplied,
  hasRepliedToComment,
  loadState,
  markReplied,
  updateCommentSweep
} from "./state.mjs";
import { parseUiXml } from "./ui-xml.mjs";
import {
  dateKey,
  ensureDir,
  hashText,
  nowIso,
  withFileLock,
  writeJson
} from "./utils.mjs";
import { XiaohongshuAutomation } from "./xhs.mjs";
import {
  findCommentsInboxReplyActionNodes,
  findReplyComposerInputNode,
  findReplyComposerSendNode
} from "./xhs-screen.mjs";
import {
  getCurrentInputMethod,
  inputUnicodeAdbKeyboard,
  keyevent,
  setInputMethod,
  sleep,
  tap
} from "./adb.mjs";

const IGNORE_TEXT = new Set([
  "首页",
  "市集",
  "发布",
  "消息",
  "我",
  "赞和收藏",
  "新增关注",
  "评论和@",
  "关注",
  "赞",
  "发送",
  "返回"
]);

const IGNORE_PATTERNS = [
  /^收到的评论和@$/,
  /^评论了你的笔记$/,
  /^回复了你的评论$/,
  /^你的粉丝$/,
  /^- THE END -$/,
  /^(今天|昨天)\s*\d{1,2}:\d{2}$/,
  /^\d{1,2}:\d{2}$/,
  /^\d+\s*(分钟前|小时前|天前)$/
];

const ACTION_LABELS = new Set([
  "评论了你的笔记",
  "回复了你的评论",
  "你的好友"
]);

const ADB_KEYBOARD_IME = "com.android.adbkeyboard/.AdbIME";

function parseArgs(argv) {
  return {
    device: process.env.XHS_DEVICE_PROFILE || DEFAULTS.device,
    autoSend: argv.includes("--auto-send"),
    dryRun: argv.includes("--dry-run"),
    force: argv.includes("--force"),
    offline: argv.includes("--offline"),
    maxReplies: argv.includes("--max-replies")
      ? Number(argv[argv.indexOf("--max-replies") + 1])
      : DEFAULTS.maxAutoRepliesPerRun
  };
}

function sameBounds(a, b) {
  return (
    a &&
    b &&
    a.left === b.left &&
    a.top === b.top &&
    a.right === b.right &&
    a.bottom === b.bottom
  );
}

function boundsContain(outer, inner) {
  return (
    outer &&
    inner &&
    outer.left <= inner.left &&
    outer.top <= inner.top &&
    outer.right >= inner.right &&
    outer.bottom >= inner.bottom
  );
}

function boundsArea(bounds) {
  return (bounds.right - bounds.left) * (bounds.bottom - bounds.top);
}

function normalizeLooseText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function isIgnorableCommentText(text) {
  const value = text.trim();
  return (
    !value ||
    IGNORE_TEXT.has(value) ||
    IGNORE_PATTERNS.some((pattern) => pattern.test(value)) ||
    /^https?:\/\//.test(value) ||
    value.includes("#")
  );
}

function findReplyActionContainer(nodes, replyTextNode) {
  const candidates = nodes
    .filter(
      (node) =>
        (node.focusable || node.clickable) &&
        node.bounds &&
        replyTextNode.bounds &&
        boundsContain(node.bounds, replyTextNode.bounds)
    )
    .sort((left, right) => boundsArea(left.bounds) - boundsArea(right.bounds));

  const compact = candidates.find((node) => {
    const width = node.bounds.right - node.bounds.left;
    const height = node.bounds.bottom - node.bounds.top;
    return width <= 260 && height <= 140;
  });

  return compact || replyTextNode;
}

function isActionLabelText(text) {
  return ACTION_LABELS.has(String(text || "").trim());
}

function buildKnownReplyTextSet(state) {
  return new Set(
    Object.values(state?.replies || {})
      .map((reply) => normalizeLooseText(reply.replyText))
      .filter(Boolean)
  );
}

function findAuthorNode(nodes, commentNode) {
  return (
    nodes
      .filter(
        (node) =>
          node.text &&
          node.bounds &&
          !isIgnorableCommentText(node.text) &&
          !isActionLabelText(node.text) &&
          node.bounds.bottom <= commentNode.bounds.top + 24 &&
          commentNode.bounds.top - node.bounds.bottom <= 220 &&
          node.bounds.left <= commentNode.bounds.left + 40
      )
      .sort((left, right) => {
        const leftGap = commentNode.bounds.top - left.bounds.bottom;
        const rightGap = commentNode.bounds.top - right.bounds.bottom;
        return leftGap - rightGap;
      })[0] || null
  );
}

function findInteractionType(nodes, commentNode) {
  const labelNode =
    nodes
      .filter(
        (node) =>
          node.text &&
          node.bounds &&
          isActionLabelText(node.text) &&
          node.bounds.bottom <= commentNode.bounds.top + 24 &&
          commentNode.bounds.top - node.bounds.bottom <= 180
      )
      .sort((left, right) => {
        const leftGap = commentNode.bounds.top - left.bounds.bottom;
        const rightGap = commentNode.bounds.top - right.bounds.bottom;
        return leftGap - rightGap;
      })[0] || null;

  if (!labelNode) {
    return "comment";
  }

  return labelNode.text.includes("回复") ? "reply-to-your-reply" : "comment";
}

function findInteractionLabelNode(nodes, replyActionNode) {
  return (
    nodes
      .filter(
        (node) =>
          node.text &&
          node.bounds &&
          isActionLabelText(node.text) &&
          node.bounds.bottom <= replyActionNode.bounds.top + 24 &&
          replyActionNode.bounds.top - node.bounds.bottom <= 320 &&
          node.bounds.left <= replyActionNode.bounds.left + 24
      )
      .sort((left, right) => {
        const leftGap = replyActionNode.bounds.top - left.bounds.bottom;
        const rightGap = replyActionNode.bounds.top - right.bounds.bottom;
        return leftGap - rightGap;
      })[0] || null
  );
}

function findLegacyCommentNode(nodes, replyActionNode) {
  return nodes
    .filter((node) => node.text && node.bounds && !isIgnorableCommentText(node.text))
    .filter((node) => node.bounds.bottom <= replyActionNode.bounds.top + 48)
    .filter((node) => node.bounds.top < replyActionNode.bounds.top - 12)
    .filter((node) => replyActionNode.bounds.top - node.bounds.bottom <= 320)
    .filter((node) => node.bounds.left <= replyActionNode.bounds.left)
    .sort((left, right) => {
      const leftGap = replyActionNode.bounds.top - left.bounds.bottom;
      const rightGap = replyActionNode.bounds.top - right.bounds.bottom;
      return leftGap - rightGap;
    })[0];
}

function findPreviousContextText(nodes, commentNode, replyActionNode) {
  return (
    nodes
      .filter(
        (node) =>
          node.text &&
          node.bounds &&
          !isIgnorableCommentText(node.text) &&
          !isActionLabelText(node.text) &&
          node.text.trim() !== commentNode.text.trim() &&
          node.bounds.top >= commentNode.bounds.bottom - 8 &&
          node.bounds.bottom <= replyActionNode.bounds.top + 20 &&
          replyActionNode.bounds.top - node.bounds.bottom <= 260
      )
      .sort((left, right) => left.bounds.top - right.bounds.top)[0]?.text.trim() || ""
  );
}

function buildThreadContext(state, entry, postPackage) {
  const previousReplyRecord = entry.previousContextText
    ? findReplyByText(state, entry.previousContextText)
    : null;
  const threadKey =
    previousReplyRecord?.threadKey ||
    buildCommentThreadKey(
      [
        postPackage.title,
        entry.authorName || "",
        previousReplyRecord?.commentText || entry.commentText,
        entry.interactionType
      ]
        .filter(Boolean)
        .join("|")
    );

  const history = getThreadMessages(state, threadKey);
  const seededHistory =
    history.length > 0
      ? history
      : previousReplyRecord
        ? [
            {
              role: "user",
              text: previousReplyRecord.commentText,
              interactionType: previousReplyRecord.interactionType || "comment"
            },
            {
              role: "assistant",
              text: previousReplyRecord.replyText,
              interactionType: "reply"
            }
          ]
        : [];

  return {
    threadKey,
    history: seededHistory,
    previousReplyRecord
  };
}

function extractCommentEntries(nodes) {
  const replyTextNodes = findCommentsInboxReplyActionNodes(nodes);
  const entries = [];

  for (const replyTextNode of replyTextNodes) {
    const replyActionNode = findReplyActionContainer(nodes, replyTextNode);
    const threadTextNodes = nodes
      .filter((node) => node.text && node.bounds && !isIgnorableCommentText(node.text))
      .filter((node) => node.bounds.bottom <= replyActionNode.bounds.top + 48)
      .filter((node) => node.bounds.top < replyActionNode.bounds.top - 12)
      .filter((node) => replyActionNode.bounds.top - node.bounds.bottom <= 420)
      .filter((node) => node.bounds.left <= replyActionNode.bounds.left)
      .sort((left, right) => {
        if (left.bounds.top !== right.bounds.top) {
          return left.bounds.top - right.bounds.top;
        }

        return left.bounds.left - right.bounds.left;
      });

    const interactionLabelNode = findInteractionLabelNode(nodes, replyActionNode);
    const authorHeaderNode =
      interactionLabelNode
        ? threadTextNodes
            .filter(
              (node) =>
                node.text &&
                node.bounds &&
                !isActionLabelText(node.text) &&
                !isIgnorableCommentText(node.text) &&
                (node.clickable || node.focusable) &&
                node.bounds.bottom <= interactionLabelNode.bounds.top + 16 &&
                interactionLabelNode.bounds.top - node.bounds.bottom <= 220
            )
            .sort((left, right) => {
              const leftGap = interactionLabelNode.bounds.top - left.bounds.bottom;
              const rightGap = interactionLabelNode.bounds.top - right.bounds.bottom;
              return leftGap - rightGap;
            })[0] || null
        : null;

    const headerBottom = Math.max(
      authorHeaderNode?.bounds?.bottom || 0,
      interactionLabelNode?.bounds?.bottom || 0
    );
    const messageNodes = threadTextNodes.filter(
      (node) =>
        !isActionLabelText(node.text) &&
        normalizeLooseText(node.text) !== normalizeLooseText(authorHeaderNode?.text) &&
        node.bounds.top >= headerBottom - 8
    );
    const commentNode = messageNodes[0] || findLegacyCommentNode(nodes, replyActionNode);

    if (!commentNode) {
      continue;
    }

    const authorNode = authorHeaderNode || findAuthorNode(nodes, commentNode);
    const interactionType = interactionLabelNode
      ? interactionLabelNode.text.includes("回复")
        ? "reply-to-your-reply"
        : "comment"
      : findInteractionType(nodes, commentNode);
    const previousContextText =
      messageNodes
        .slice(1)
        .map((node) => normalizeLooseText(node.text))
        .find(Boolean) ||
      findPreviousContextText(nodes, commentNode, replyActionNode);

    entries.push({
      authorName: normalizeLooseText(authorNode?.text),
      commentText: normalizeLooseText(commentNode.text),
      interactionType,
      previousContextText: normalizeLooseText(previousContextText),
      commentBounds: commentNode.bounds,
      replyActionBounds: replyActionNode.bounds
    });
  }

  return entries.filter((entry, index, items) => {
    return (
      items.findIndex(
        (candidate) =>
          candidate.commentText === entry.commentText &&
          sameBounds(candidate.replyActionBounds, entry.replyActionBounds)
      ) === index
    );
  });
}

function normalizeCommentEntry(entry, knownReplyTexts) {
  const authorName = normalizeLooseText(entry.authorName);
  const commentText = normalizeLooseText(entry.commentText);
  let previousContextText = normalizeLooseText(entry.previousContextText);

  if (!commentText) {
    return null;
  }

  if (knownReplyTexts?.has(commentText)) {
    if (authorName && authorName !== commentText && !knownReplyTexts.has(authorName)) {
      previousContextText ||= commentText;
      return {
        ...entry,
        authorName: "",
        commentText: authorName,
        previousContextText
      };
    }

    return null;
  }

  return {
    ...entry,
    authorName: knownReplyTexts?.has(authorName) ? "" : authorName,
    commentText,
    previousContextText: previousContextText === commentText ? "" : previousContextText
  };
}

export function extractCommentEntriesFromNodes(nodes, state = null) {
  const knownReplyTexts = state ? buildKnownReplyTextSet(state) : null;
  const entries = extractCommentEntries(nodes)
    .map((entry) => normalizeCommentEntry(entry, knownReplyTexts))
    .filter(Boolean);

  return entries.filter((entry, index, items) => {
    return (
      items.findIndex(
        (candidate) =>
          candidate.commentText === entry.commentText &&
          candidate.previousContextText === entry.previousContextText &&
          sameBounds(candidate.replyActionBounds, entry.replyActionBounds)
      ) === index
    );
  });
}

async function clearReplyComposerInput(inputNode, replyKey, runDir, xhs) {
  const currentText = inputNode.text.trim();
  const hintText = inputNode.hint.trim();

  if (!currentText || currentText === hintText) {
    return;
  }

  for (let index = 0; index < currentText.length + 4; index += 1) {
    keyevent(67);
    await sleep(30);
  }

  await sleep(250);
  await xhs.captureSnapshot(`reply-${replyKey}-after-clear`, runDir);
}

async function autoSendReply(reply, runDir, xhs, state) {
  const preSnapshot = await xhs.captureSnapshot(`reply-${reply.replyKey}-comments-start`, runDir);
  const entry =
    extractCommentEntriesFromNodes(preSnapshot.analysis.nodes, state)
      .find(
        (item) =>
          item.commentText === reply.commentText &&
          (!reply.authorName || item.authorName === reply.authorName)
      ) || null;

  if (!entry?.replyActionBounds) {
    return false;
  }

  const previousIme = getCurrentInputMethod();
  if (previousIme !== ADB_KEYBOARD_IME) {
    setInputMethod(ADB_KEYBOARD_IME);
    await sleep(600);
  }

  try {
    await xhs.focusNodeByTab({
      targetBounds: entry.replyActionBounds,
      outputDir: runDir,
      stepPrefix: `reply-${reply.replyKey}-reply-action`,
      maxTabs: 18
    });

    const composer = await xhs.activateFocusedNode(
      runDir,
      `reply-${reply.replyKey}-open-composer`
    );
    let activeComposer = composer;

    if (activeComposer.analysis.screen !== "reply-composer") {
      tap(entry.replyActionBounds.centerX, entry.replyActionBounds.centerY);
      await sleep(1200);
      activeComposer = await xhs.captureSnapshot(
        `reply-${reply.replyKey}-open-composer-tap-fallback`,
        runDir
      );
    }

    if (activeComposer.analysis.screen !== "reply-composer") {
      return false;
    }

    let inputNode = findReplyComposerInputNode(activeComposer.analysis.nodes);
    if (!inputNode?.bounds) {
      return false;
    }

    await clearReplyComposerInput(inputNode, reply.replyKey, runDir, xhs);

    inputUnicodeAdbKeyboard(reply.replyText);
    await sleep(900);

    const afterInput = await xhs.captureSnapshot(`reply-${reply.replyKey}-after-input`, runDir);
    inputNode = findReplyComposerInputNode(afterInput.analysis.nodes);

    if (!inputNode || !inputNode.text.includes(reply.replyText.slice(0, 4))) {
      return false;
    }

    const sendNode = findReplyComposerSendNode(afterInput.analysis.nodes);
    if (!sendNode?.bounds || !sendNode.enabled) {
      return false;
    }

    tap(sendNode.bounds.centerX, sendNode.bounds.centerY);
    await sleep(1200);
    let afterSend = await xhs.captureSnapshot(`reply-${reply.replyKey}-after-send`, runDir);

    if (afterSend.analysis.screen === "reply-composer") {
      await xhs.focusNodeByTab({
        targetBounds: sendNode.bounds,
        outputDir: runDir,
        stepPrefix: `reply-${reply.replyKey}-send-action`,
        maxTabs: 12
      });
      afterSend = await xhs.activateFocusedNode(runDir, `reply-${reply.replyKey}-send-enter`);
    }

    if (afterSend.analysis.screen === "reply-composer") {
      tap(sendNode.bounds.centerX, sendNode.bounds.centerY);
      await sleep(1200);
      afterSend = await xhs.captureSnapshot(
        `reply-${reply.replyKey}-send-tap-fallback`,
        runDir
      );
    }

    return afterSend.analysis.screen !== "reply-composer";
  } finally {
    if (previousIme && previousIme !== ADB_KEYBOARD_IME) {
      setInputMethod(previousIme);
    }
  }
}

export async function runCommentPipeline(options = {}) {
  return withFileLock(resolve(LOCKS_DIR, "device.lock"), async () => {
    const state = loadState();
    const postPackage = await ensureDailyPackage({
      offline: options.offline
    });

    if (options.dryRun) {
      return {
        outputPath: null,
        sentCount: 0,
        items: [],
        mode: "dry-run",
        title: postPackage.title
      };
    }

    const xhs = new XiaohongshuAutomation(options.device || DEFAULTS.device);
    const dayKey = dateKey(new Date(), DEFAULTS.timezone);
    const runDir = `${COMMENTS_DIR}/${dayKey}`;
    const timestamp = nowIso().replace(/[:.]/g, "-");
    const xmlPath = `${runDir}/${timestamp}-comments.xml`;
    const screenshotDir = `${runDir}/artifacts`;

    ensureDir(runDir);
    ensureDir(screenshotDir);

    await xhs.openCommentsInbox(screenshotDir);
    await xhs.captureSnapshot(`${timestamp}-comments-inbox`, screenshotDir);
    xhs.dumpUi(xmlPath);

    const xml = readFileSync(xmlPath, "utf8");
    const nodes = parseUiXml(xml);
    const commentEntries = extractCommentEntriesFromNodes(nodes, state);
    const generatedReplies = await Promise.all(
      commentEntries
        .filter((entry) => isSafeForAutoReply(entry.commentText))
        .map(async (entry) => {
          const threadContext = buildThreadContext(state, entry, postPackage);
          const commentFingerprint = buildCommentFingerprint({
            authorName: entry.authorName,
            commentText: entry.commentText,
            interactionType: entry.interactionType,
            previousContextText: entry.previousContextText,
            threadKey: threadContext.threadKey
          });
          const replyText = await buildReplyDraft(
            {
              ...entry,
              commentFingerprint,
              threadKey: threadContext.threadKey,
              history: threadContext.history
            },
            postPackage
          );
          const replyKey = hashText(`${threadContext.threadKey}|${entry.commentText}|${replyText}`);
          return {
            ...entry,
            replyKey,
            commentFingerprint,
            threadKey: threadContext.threadKey,
            history: threadContext.history,
            replyText,
            alreadySent:
              hasReplied(state, replyKey) ||
              hasRepliedToComment(state, {
                authorName: entry.authorName,
                commentText: entry.commentText,
                interactionType: entry.interactionType,
                previousContextText: entry.previousContextText,
                threadKey: threadContext.threadKey,
                commentFingerprint
              })
          };
        })
    );

    const comments = generatedReplies
      .filter((item) => !item.alreadySent);

    const results = [];
    let sentCount = 0;

    for (const comment of comments) {
      const record = { ...comment, sent: false };

      if (
        options.autoSend &&
        sentCount < (options.maxReplies || DEFAULTS.maxAutoRepliesPerRun)
      ) {
        const sent = await autoSendReply(comment, runDir, xhs, state);
        record.sent = sent;
        if (sent) {
          sentCount += 1;
          markReplied(state, comment.replyKey, {
            authorName: comment.authorName,
            commentText: comment.commentText,
            commentFingerprint: comment.commentFingerprint,
            replyText: comment.replyText,
            threadKey: comment.threadKey,
            interactionType: comment.interactionType,
            previousContextText: comment.previousContextText,
            sourcePostTitle: postPackage.title
          });
        }
      }

      results.push(record);
    }

    const outputPath = `${runDir}/${timestamp}-replies.json`;
    writeJson(outputPath, {
      createdAt: nowIso(),
      sentCount,
      items: results
    });

    updateCommentSweep(state);

    return {
      outputPath,
      sentCount,
      items: results
    };
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await runCommentPipeline(args);
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
