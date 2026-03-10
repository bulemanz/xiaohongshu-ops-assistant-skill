import { readFileSync } from "node:fs";
import { parseUiXml, uniqueVisibleTexts } from "./ui-xml.mjs";

function hasText(nodes, value) {
  return nodes.some((node) => node.text === value);
}

function hasHint(nodes, value) {
  return nodes.some((node) => node.hint === value);
}

function hasContentDesc(nodes, value) {
  return nodes.some((node) => node.contentDesc === value);
}

function findEditableNode(nodes, predicate) {
  return nodes.find((node) => {
    if (!node.bounds) return false;
    if (!node.className.includes("EditText")) return false;
    return predicate(node);
  });
}

export function findEditorTitleNode(nodes) {
  return (
    findEditableNode(nodes, (node) => node.hint === "添加标题") ||
    findEditableNode(nodes, (node) => node.text === "添加标题") ||
    findEditableNode(nodes, (node) => node.bounds.top >= 500 && node.bounds.bottom <= 760)
  );
}

export function findEditorBodyNode(nodes) {
  return (
    findEditableNode(nodes, (node) => node.hint === "添加正文或发语音") ||
    findEditableNode(nodes, (node) => node.text === "添加正文") ||
    findEditableNode(nodes, (node) => node.bounds.top >= 650 && node.bounds.bottom >= 1000)
  );
}

export function findEditorPublishNode(nodes) {
  return (
    nodes.find((node) => node.text === "发布" && node.bounds) ||
    nodes.find((node) => node.text === "发布笔记" && node.bounds)
  );
}

export function findEditorDraftNode(nodes) {
  return nodes.find((node) => node.text === "存草稿" && node.bounds);
}

export function findBackNode(nodes) {
  return nodes.find((node) => node.contentDesc === "返回" && node.bounds);
}

export function findDraftPopupResumeNode(nodes) {
  return nodes.find((node) => node.text === "去编辑" && node.bounds);
}

export function findHomePublishNode(nodes) {
  return nodes.find((node) => node.contentDesc === "发布" && node.bounds);
}

export function findSaveDraftConfirmNode(nodes) {
  return nodes.find((node) => node.text === "确定" && node.bounds);
}

export function findMessagesCommentsCardNode(nodes) {
  return (
    nodes.find((node) => node.contentDesc.includes("评论和@") && node.bounds) ||
    nodes.find((node) => node.text === "评论和@" && node.bounds)
  );
}

export function findMessagesRootNode(nodes) {
  return nodes.find((node) => node.text === "消息" && node.bounds);
}

export function findCommentsInboxReplyActionNodes(nodes) {
  return nodes.filter((node) => node.text === "回复" && node.bounds);
}

export function findReplyComposerInputNode(nodes) {
  return (
    findEditableNode(nodes, (node) => node.hint.startsWith("回复 @")) ||
    findEditableNode(nodes, (node) => node.text.startsWith("回复 @"))
  );
}

export function findReplyComposerSendNode(nodes) {
  return (
    nodes.find((node) => node.text === "发送" && node.bounds && node.enabled) ||
    nodes.find((node) => node.text === "发送" && node.bounds)
  );
}

export function detectScreen(nodes) {
  if (hasText(nodes, "确认保存笔记至草稿箱吗?") || hasText(nodes, "确定")) {
    return "save-draft-confirm";
  }

  if (hasText(nodes, "继续编辑图文笔记吗？") || hasText(nodes, "去编辑")) {
    return "draft-popup";
  }

  if (
    ((hasHint(nodes, "添加标题") || hasText(nodes, "添加标题")) &&
      (hasHint(nodes, "添加正文或发语音") || hasText(nodes, "发布笔记"))) ||
    (findEditorBodyNode(nodes) && findEditorDraftNode(nodes) && findEditorPublishNode(nodes))
  ) {
    return "editor";
  }

  if (
    hasContentDesc(nodes, "首页") &&
    hasContentDesc(nodes, "发布") &&
    hasContentDesc(nodes, "消息")
  ) {
    return "home";
  }

  if (
    hasText(nodes, "消息") &&
    hasText(nodes, "赞和收藏") &&
    hasText(nodes, "新增关注") &&
    hasText(nodes, "评论和@")
  ) {
    return "messages-home";
  }

  if (hasText(nodes, "收到的评论和@") && hasText(nodes, "回复")) {
    return "comments-inbox";
  }

  if (
    nodes.some((node) => node.className.includes("EditText") && node.hint.startsWith("回复 @")) &&
    hasText(nodes, "发送")
  ) {
    return "reply-composer";
  }

  if (
    hasText(nodes, "所有照片") ||
    hasText(nodes, "最近项目") ||
    hasText(nodes, "相册") ||
    hasText(nodes, "最近") ||
    hasText(nodes, "下一步")
  ) {
    return "image-picker";
  }

  return "unknown";
}

function buildTargets(nodes) {
  const title = findEditorTitleNode(nodes);
  const body = findEditorBodyNode(nodes);
  const publish = findEditorPublishNode(nodes);
  const draft = findEditorDraftNode(nodes);
  const resume = findDraftPopupResumeNode(nodes);
  const homePublish = findHomePublishNode(nodes);
  const confirmSaveDraft = findSaveDraftConfirmNode(nodes);
  const messagesComments = findMessagesCommentsCardNode(nodes);
  const replyComposerInput = findReplyComposerInputNode(nodes);
  const replyComposerSend = findReplyComposerSendNode(nodes);
  const firstReplyAction = findCommentsInboxReplyActionNodes(nodes)[0];

  return {
    title: title ? title.bounds : null,
    body: body ? body.bounds : null,
    publish: publish ? publish.bounds : null,
    draft: draft ? draft.bounds : null,
    resumeDraft: resume ? resume.bounds : null,
    homePublish: homePublish ? homePublish.bounds : null,
    confirmSaveDraft: confirmSaveDraft ? confirmSaveDraft.bounds : null,
    messagesComments: messagesComments ? messagesComments.bounds : null,
    commentsReply: firstReplyAction ? firstReplyAction.bounds : null,
    replyComposerInput: replyComposerInput ? replyComposerInput.bounds : null,
    replyComposerSend: replyComposerSend ? replyComposerSend.bounds : null
  };
}

export function analyzeUiXml(xml) {
  const nodes = parseUiXml(xml);
  return {
    screen: detectScreen(nodes),
    visibleTexts: uniqueVisibleTexts(nodes).slice(0, 40),
    targets: buildTargets(nodes),
    nodes
  };
}

export function analyzeUiXmlFile(xmlPath) {
  return analyzeUiXml(readFileSync(xmlPath, "utf8"));
}
