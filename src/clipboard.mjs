import { adbShell, keyevent, sleep } from "./adb.mjs";

export async function pasteClipboardText(text) {
    // 1. Encode text to base64
    const b64 = Buffer.from(text).toString("base64");

    // 2. Push to clipboard via app_process/cmd (Works on Android 7+)
    // We use `cmd` service to populate clipboard directly
    adbShell(
        "cmd", "clipboard", "set",
        "`echo -n '" + b64 + "' | base64 -d`"
    );

    await sleep(500);

    // 3. Simulate PASTE keyevent (279 = KEYCODE_PASTE)
    keyevent(279);

    await sleep(500);
}
