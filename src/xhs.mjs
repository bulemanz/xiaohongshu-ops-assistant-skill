import { writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import {
  adbShell,
  dumpUiXml,
  getCurrentInputMethod,
  inputAscii,
  inputUnicodeAdbKeyboard,
  keyevent,
  launchApp,
  mediaScan,
  push,
  screenshot,
  setInputMethod,
  sleep,
  startImageShare,
  tap
} from "./adb.mjs";
import { getDeviceProfile } from "./device-profiles.mjs";
import {
  analyzeUiXmlFile,
  findBackNode,
  findDraftPopupResumeNode,
  findEditorBodyNode,
  findEditorDraftNode,
  findEditorPublishNode,
  findEditorTitleNode,
  findMessagesCommentsCardNode,
  findSaveDraftConfirmNode
} from "./xhs-screen.mjs";

function tapBounds(bounds) {
  tap(bounds.centerX, bounds.centerY);
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

function buildCardTapPoints(bounds, fallback) {
  if (!bounds) {
    return [fallback];
  }

  const { left, right, top, bottom, centerX, centerY } = bounds;
  const points = [
    { x: centerX, y: centerY },
    { x: centerX, y: Math.round(top + (bottom - top) * 0.38) },
    { x: Math.round(left + (right - left) * 0.5), y: Math.round(top + (bottom - top) * 0.72) },
    { x: Math.round(left + (right - left) * 0.35), y: Math.round(top + (bottom - top) * 0.5) }
  ];

  return points.filter((point, index, items) => {
    return items.findIndex((item) => item.x === point.x && item.y === point.y) === index;
  });
}

const ADB_KEYBOARD_IME = "com.android.adbkeyboard/.AdbIME";

function normalizeEditableText(node) {
  const text = (node?.text || "").trim();
  const hint = (node?.hint || "").trim();

  if (!text || text === hint) {
    return "";
  }

  return text;
}

function getEditorNode(kind, nodes) {
  return kind === "title" ? findEditorTitleNode(nodes) : findEditorBodyNode(nodes);
}

function buildFocusPoints(kind, node, fallback) {
  if (!node?.bounds) {
    return [fallback];
  }

  const { left, right, top, bottom, centerX, centerY } = node.bounds;
  const points = [
    { x: centerX, y: centerY },
    { x: Math.min(left + 96, right - 24), y: centerY },
    { x: Math.min(left + 48, right - 24), y: Math.round((top + bottom) / 2) },
    { x: Math.min(left + 96, right - 24), y: Math.min(top + 42, bottom - 12) }
  ];

  if (kind === "body") {
    points.unshift({ x: Math.min(left + 80, right - 24), y: Math.min(top + 80, bottom - 24) });
  }

  return points.filter((point, index, items) => {
    return items.findIndex((item) => item.x === point.x && item.y === point.y) === index;
  });
}

export class XiaohongshuAutomation {
  constructor(deviceProfileName) {
    this.profile = getDeviceProfile(deviceProfileName);
  }

  async launch() {
    launchApp("com.xingin.xhs");
    await sleep(2200);
  }

  async captureSnapshot(name, outputDir) {
    const pngPath = resolve(outputDir, `${name}.png`);
    const xmlPath = resolve(outputDir, `${name}.xml`);
    const metaPath = resolve(outputDir, `${name}.json`);

    screenshot(pngPath);
    dumpUiXml(xmlPath);

    const analysis = analyzeUiXmlFile(xmlPath);
    const metadata = {
      name,
      screen: analysis.screen,
      targets: analysis.targets,
      visibleTexts: analysis.visibleTexts
    };

    writeFileSync(metaPath, `${JSON.stringify(metadata, null, 2)}\n`);

    return {
      pngPath,
      xmlPath,
      metaPath,
      analysis
    };
  }

  async expectScreen(name, outputDir, expectedScreens) {
    const snapshot = await this.captureSnapshot(name, outputDir);
    const expected = Array.isArray(expectedScreens) ? expectedScreens : [expectedScreens];

    if (!expected.includes(snapshot.analysis.screen)) {
      throw new Error(
        `[xhs] expected ${expected.join(" or ")}, got ${snapshot.analysis.screen}. ` +
          `See ${snapshot.pngPath} and ${snapshot.metaPath}`
      );
    }

    return snapshot;
  }

  async openEditorWithImage(localImagePath, outputDir) {
    await this.launch();

    if (outputDir) {
      await this.captureSnapshot("00-after-launch", outputDir);
    }

    const remotePath = `/sdcard/DCIM/OpenClaw/${basename(localImagePath)}`;
    push(localImagePath, remotePath);
    mediaScan(remotePath);
    await sleep(1200);
    startImageShare(remotePath);
    await sleep(3200);

    if (outputDir) {
      const snapshot = await this.captureSnapshot("01-after-share", outputDir);

      if (snapshot.analysis.screen === "draft-popup") {
        const resumeNode = findDraftPopupResumeNode(snapshot.analysis.nodes);
        if (!resumeNode) {
          throw new Error(`[xhs] draft popup detected but 去编辑 not found. See ${snapshot.metaPath}`);
        }
        tapBounds(resumeNode.bounds);
        await sleep(1500);
        let resumed = await this.captureSnapshot("02-after-resume-draft", outputDir);
        if (resumed.analysis.screen !== "editor") {
          keyevent(22);
          await sleep(500);
          keyevent(66);
          await sleep(1500);
          resumed = await this.captureSnapshot("03-after-resume-draft-dpad", outputDir);
        }
        if (resumed.analysis.screen !== "editor") {
          throw new Error(
            `[xhs] failed to resume draft editor. Got ${resumed.analysis.screen}. See ${resumed.pngPath}`
          );
        }
      } else if (snapshot.analysis.screen !== "editor") {
        throw new Error(
          `[xhs] share did not open editor. Got ${snapshot.analysis.screen}. ` +
            `See ${snapshot.pngPath} and ${snapshot.metaPath}`
        );
      }
    }

    return remotePath;
  }

  async focusField(kind, outputDir, stepName) {
    const snapshot = await this.expectScreen(stepName, outputDir, "editor");
    const node =
      kind === "title"
        ? findEditorTitleNode(snapshot.analysis.nodes)
        : findEditorBodyNode(snapshot.analysis.nodes);

    const fallback =
      kind === "title" ? this.profile.editor.titleField : this.profile.editor.bodyField;
    const attempts = buildFocusPoints(kind, node, fallback);

    for (let index = 0; index < attempts.length; index += 1) {
      const point = attempts[index];
      tap(point.x, point.y);
      await sleep(500);

      const focused = await this.expectScreen(
        `${stepName}-focus-attempt-${index + 1}`,
        outputDir,
        "editor"
      );
      const focusedNode =
        kind === "title"
          ? findEditorTitleNode(focused.analysis.nodes)
          : findEditorBodyNode(focused.analysis.nodes);

      if (focusedNode?.focused) {
        return focused;
      }
    }

    throw new Error(
      `[xhs] failed to focus ${kind} field after ${attempts.length} attempts. ` +
        `See ${resolve(outputDir, `${stepName}-focus-attempt-${attempts.length}.png`)}`
    );
  }

  async verifyTitle(title, outputDir, stepName) {
    const snapshot = await this.expectScreen(stepName, outputDir, "editor");
    const titleNode = findEditorTitleNode(snapshot.analysis.nodes);

    if (!titleNode || titleNode.text.trim() !== title.trim()) {
      throw new Error(
        `[xhs] title verification failed. Expected "${title}", got "${titleNode?.text || ""}". ` +
          `See ${snapshot.pngPath} and ${snapshot.metaPath}`
      );
    }
  }

  async verifyBody(body, outputDir, stepName) {
    const snapshot = await this.expectScreen(stepName, outputDir, "editor");
    const bodyNode = findEditorBodyNode(snapshot.analysis.nodes);
    const expectedPrefix = body.trim().slice(0, 12);

    if (!bodyNode || !bodyNode.text.includes(expectedPrefix)) {
      throw new Error(
        `[xhs] body verification failed. Expected prefix "${expectedPrefix}". ` +
          `See ${snapshot.pngPath} and ${snapshot.metaPath}`
      );
    }
  }

  async clearFocusedField(kind, outputDir, stepName) {
    const snapshot = await this.expectScreen(stepName, outputDir, "editor");
    const node = getEditorNode(kind, snapshot.analysis.nodes);
    const currentText = normalizeEditableText(node);

    if (!currentText) {
      return;
    }

    try {
      adbShell("input", "keycombination", "-t", "180", "113", "29");
      await sleep(200);
      keyevent(67);
      await sleep(280);
    } catch {
      // Fall back to repeated delete below if keycombination is ignored.
    }

    let afterClear = await this.expectScreen(`${stepName}-after-select-all`, outputDir, "editor");
    let focusedNode = getEditorNode(kind, afterClear.analysis.nodes);
    let residualText = normalizeEditableText(focusedNode);

    if (!residualText) {
      return;
    }

    for (let index = 0; index < residualText.length + 12; index += 1) {
      keyevent(67);
      await sleep(18);
    }

    await sleep(260);

    afterClear = await this.expectScreen(`${stepName}-after-backspace-clear`, outputDir, "editor");
    focusedNode = getEditorNode(kind, afterClear.analysis.nodes);
    residualText = normalizeEditableText(focusedNode);

    if (residualText) {
      throw new Error(
        `[xhs] failed to clear ${kind} field. Residual text: "${residualText}". ` +
          `See ${afterClear.pngPath} and ${afterClear.metaPath}`
      );
    }
  }

  async fillTitleAndBody({ title, body, textMode = "skip", outputDir }) {
    let previousIme = null;

    if (textMode === "adb-keyboard") {
      previousIme = getCurrentInputMethod();
      if (previousIme !== ADB_KEYBOARD_IME) {
        setInputMethod(ADB_KEYBOARD_IME);
        await sleep(600);
      }
    }

    try {
      if (title) {
        await this.focusField("title", outputDir, "03-before-title");
        await this.clearFocusedField("title", outputDir, "03-title-clear");
        if (textMode === "ascii") inputAscii(title);
        if (textMode === "adb-keyboard") inputUnicodeAdbKeyboard(title);
        await sleep(700);
        await this.verifyTitle(title, outputDir, "04-after-title-input");
      }

      if (body) {
        await this.focusField("body", outputDir, "05-before-body");
        await this.clearFocusedField("body", outputDir, "05-body-clear");
        if (textMode === "ascii") inputAscii(body);
        if (textMode === "adb-keyboard") inputUnicodeAdbKeyboard(body);
        await sleep(700);
        await this.verifyBody(body, outputDir, "06-after-body-input");
      }
    } finally {
      if (textMode === "adb-keyboard" && previousIme && previousIme !== ADB_KEYBOARD_IME) {
        setInputMethod(previousIme);
      }
    }
  }

  async openMessages(outputDir) {
    await this.launch();
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      tap(this.profile.home.messageTab.x, this.profile.home.messageTab.y);
      await sleep(1600);

      if (!outputDir) {
        return null;
      }

      const snapshot = await this.captureSnapshot(
        attempt === 1 ? "20-after-open-messages" : `20-after-open-messages-attempt-${attempt}`,
        outputDir
      );

      if (
        snapshot.analysis.screen === "messages-home" ||
        snapshot.analysis.screen === "comments-inbox"
      ) {
        return snapshot;
      }
    }

    if (outputDir) {
      const finalSnapshot = await this.captureSnapshot("20-after-open-messages-failed", outputDir);
      throw new Error(
        `[xhs] expected messages-home or comments-inbox after opening messages, got ${finalSnapshot.analysis.screen}. ` +
          `See ${finalSnapshot.pngPath} and ${finalSnapshot.metaPath}`
      );
    }

    throw new Error("[xhs] failed to open messages");
  }

  async openCommentsInbox(outputDir) {
    const messagesSnapshot = await this.openMessages(outputDir);
    if (messagesSnapshot?.analysis.screen === "comments-inbox") {
      return messagesSnapshot;
    }
    const cardNode = messagesSnapshot
      ? findMessagesCommentsCardNode(messagesSnapshot.analysis.nodes)
      : null;
    const attempts = buildCardTapPoints(cardNode?.bounds, this.profile.messages.commentsCard);

    for (let index = 0; index < attempts.length; index += 1) {
      const point = attempts[index];
      tap(point.x, point.y);
      await sleep(1800);

      if (!outputDir) {
        return null;
      }

      const snapshot = await this.captureSnapshot(
        `21-after-open-comments-attempt-${index + 1}`,
        outputDir
      );

      if (snapshot.analysis.screen !== "messages-home") {
        return snapshot;
      }
    }

    if (outputDir) {
      throw new Error(
        `[xhs] failed to open comments inbox after ${attempts.length} attempts. ` +
          `See ${resolve(outputDir, `21-after-open-comments-attempt-${attempts.length}.png`)}`
      );
    }

    throw new Error("[xhs] failed to open comments inbox");
  }

  async returnToMessagesHome(outputDir) {
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const snapshot = outputDir
        ? await this.captureSnapshot(`30-before-return-messages-${attempt}`, outputDir)
        : null;
      const screen = snapshot?.analysis.screen || "unknown";

      if (screen === "messages-home") {
        return snapshot;
      }

      if (screen === "home") {
        return this.openMessages(outputDir);
      }

      if (screen === "comments-inbox" || screen === "reply-composer" || screen === "unknown") {
        keyevent(4);
        await sleep(1200);
        continue;
      }

      keyevent(4);
      await sleep(1200);
    }

    const finalSnapshot = await this.openMessages(outputDir);
    if (finalSnapshot?.analysis.screen !== "messages-home") {
      throw new Error(
        `[xhs] failed to return to messages home. Got ${finalSnapshot?.analysis.screen || "unknown"}.`
      );
    }

    return finalSnapshot;
  }

  async focusNodeByTab({ targetBounds, outputDir, stepPrefix, maxTabs = 18 }) {
    for (let index = 0; index <= maxTabs; index += 1) {
      const snapshot = await this.captureSnapshot(`${stepPrefix}-focus-${index}`, outputDir);
      const focusedNode = snapshot.analysis.nodes.find((node) => node.focused && node.bounds);

      if (
        focusedNode?.bounds &&
        (sameBounds(focusedNode.bounds, targetBounds) ||
          boundsContain(focusedNode.bounds, targetBounds) ||
          boundsContain(targetBounds, focusedNode.bounds))
      ) {
        return snapshot;
      }

      if (index < maxTabs) {
        keyevent(61);
        await sleep(500);
      }
    }

    throw new Error(
      `[xhs] failed to focus target via keyboard after ${maxTabs} TAB steps. ` +
        `See ${resolve(outputDir, `${stepPrefix}-focus-${maxTabs}.png`)}`
    );
  }

  async activateFocusedNode(outputDir, stepPrefix) {
    keyevent(66);
    await sleep(1200);
    return this.captureSnapshot(`${stepPrefix}-after-enter`, outputDir);
  }

  dumpUi(localXmlPath) {
    dumpUiXml(localXmlPath);
  }

  async publish(outputDir) {
    let snapshot = await this.expectScreen("07-before-publish", outputDir, "editor");

    if (snapshot.analysis.visibleTexts.includes("完成")) {
      keyevent(4);
      await sleep(1000);
      snapshot = await this.expectScreen("07a-after-close-keyboard", outputDir, "editor");
    }

    const publishNode = findEditorPublishNode(snapshot.analysis.nodes);
    const publishBounds = publishNode?.bounds || this.profile.editor.publishButton;

    if (publishNode?.bounds) {
      tapBounds(publishNode.bounds);
    } else {
      tap(this.profile.editor.publishButton.x, this.profile.editor.publishButton.y);
    }

    await sleep(1500);

    if (outputDir) {
      let afterTap = await this.captureSnapshot("08-after-publish-tap", outputDir);

      // Some XHS builds ignore injected taps on the top-right publish button.
      if (afterTap.analysis.screen === "editor") {
        await this.focusNodeByTab({
          targetBounds: publishBounds,
          outputDir,
          stepPrefix: "08a-publish-dpad"
        });
        afterTap = await this.activateFocusedNode(outputDir, "08b-publish-dpad");
      }
    }
  }

  async saveDraft(outputDir) {
    const snapshot = await this.expectScreen("07-before-save-draft", outputDir, "editor");
    const draftNode = findEditorDraftNode(snapshot.analysis.nodes);

    if (draftNode?.bounds) {
      tapBounds(draftNode.bounds);
    } else {
      tap(this.profile.editor.saveDraftButton.x, this.profile.editor.saveDraftButton.y);
    }

    await sleep(1500);

    if (outputDir) {
      const afterTap = await this.captureSnapshot("08-after-save-draft-tap", outputDir);
      if (afterTap.analysis.screen === "save-draft-confirm") {
        const confirmNode = findSaveDraftConfirmNode(afterTap.analysis.nodes);
        if (!confirmNode?.bounds) {
          throw new Error(
            `[xhs] save-draft confirm popup detected but 确定 not found. See ${afterTap.metaPath}`
          );
        }
        tapBounds(confirmNode.bounds);
        await sleep(1500);
        let finalSnapshot = await this.captureSnapshot("09-after-save-draft-confirm", outputDir);

        // Some MIUI/XHS dialogs ignore direct touch injection. Fall back to keyboard confirm.
        if (finalSnapshot.analysis.screen === "save-draft-confirm") {
          keyevent(22);
          await sleep(500);
          keyevent(66);
          await sleep(1500);
          finalSnapshot = await this.captureSnapshot("10-after-save-draft-dpad-confirm", outputDir);
        }
      }
    }
  }

  async goBack(outputDir, stepName = "back") {
    if (outputDir) {
      const snapshot = await this.captureSnapshot(`${stepName}-before`, outputDir);
      const backNode = findBackNode(snapshot.analysis.nodes);

      if (backNode?.bounds) {
        tapBounds(backNode.bounds);
      } else {
        keyevent(4);
      }
    } else {
      keyevent(4);
    }

    await sleep(1200);

    if (outputDir) {
      await this.captureSnapshot(`${stepName}-after`, outputDir);
    }
  }

  captureState(name, outputDir) {
    screenshot(`${outputDir}/${name}.png`);
  }
}
