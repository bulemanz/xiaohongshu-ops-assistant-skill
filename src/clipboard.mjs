import { inputUnicodeAdbKeyboard, sleep } from "./adb.mjs";

export async function pasteClipboardText(text) {
  // We intentionally avoid shell-built clipboard commands here.
  // For focused fields, ADB Keyboard is the safer path.
  inputUnicodeAdbKeyboard(text);
  await sleep(500);
}
