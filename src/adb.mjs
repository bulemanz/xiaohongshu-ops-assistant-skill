import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const DEFAULT_ADB_BIN = process.env.ADB_BIN || "adb";
const DEFAULT_VENDOR_KEYS = process.env.ADB_VENDOR_KEYS || `${process.env.HOME || "~"}/.android`;
let screenCheckInProgress = false;

function buildEnv() {
  return {
    ...process.env,
    ADB_VENDOR_KEYS: process.env.ADB_VENDOR_KEYS || DEFAULT_VENDOR_KEYS
  };
}

function adbBin() {
  return process.env.ADB_BIN || DEFAULT_ADB_BIN;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function buildAdbCommand(args) {
  const adbPrefix = [
    "env",
    `ADB_VENDOR_KEYS=${shellQuote(process.env.ADB_VENDOR_KEYS || DEFAULT_VENDOR_KEYS)}`,
    shellQuote(adbBin())
  ];

  return [...adbPrefix, ...args.map((arg) => shellQuote(arg))].join(" ");
}

function runRaw(args, options = {}) {
  const result = spawnSync(
    "/bin/zsh",
    ["-lc", buildAdbCommand(args)],
    {
      env: buildEnv(),
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
      ...options
    }
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const stderr = (result.stderr || "").trim();
    const stdout = (result.stdout || "").trim();
    throw new Error(
      [`adb ${args.join(" ")}`, stderr, stdout].filter(Boolean).join("\n")
    );
  }

  return (result.stdout || "").trim();
}

function waitSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function readPowerState() {
  const result = spawnSync(
    "/bin/zsh",
    [
      "-lc",
      `${buildAdbCommand(["shell", "dumpsys", "power"])} | grep -E 'Display Power: state=|mWakefulness=' || true`
    ],
    {
      env: buildEnv(),
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024
    }
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const stderr = (result.stderr || "").trim();
    const stdout = (result.stdout || "").trim();
    throw new Error([stderr, stdout].filter(Boolean).join("\n") || "failed to read power state");
  }

  return (result.stdout || "").trim();
}

export function isScreenAwake() {
  const powerState = readPowerState();

  if (/Display Power:\s*state=ON/i.test(powerState)) {
    return true;
  }

  if (/mWakefulness=Awake/i.test(powerState)) {
    return true;
  }

  if (/Display Power:\s*state=(OFF|DOZE|DOZING)/i.test(powerState)) {
    return false;
  }

  if (/mWakefulness=(Asleep|Dozing)/i.test(powerState)) {
    return false;
  }

  return true;
}

export function ensureScreenAwake() {
  if (screenCheckInProgress) {
    return;
  }

  screenCheckInProgress = true;

  try {
    if (isScreenAwake()) {
      return;
    }

    runRaw(["shell", "input", "keyevent", "224"]);
    waitSync(1200);

    if (!isScreenAwake()) {
      throw new Error("[adb] failed to wake device screen");
    }
  } finally {
    screenCheckInProgress = false;
  }
}

function run(args, options = {}) {
  return runRaw(args, options);
}

export function adb(...args) {
  return run(args);
}

export function adbShell(...args) {
  return run(["shell", ...args]);
}

export function launchApp(packageName) {
  ensureScreenAwake();
  adbShell("monkey", "-p", packageName, "-c", "android.intent.category.LAUNCHER", "1");
}

export function tap(x, y) {
  ensureScreenAwake();
  adbShell("input", "tap", String(x), String(y));
}

export function swipe(x1, y1, x2, y2, duration = 300) {
  ensureScreenAwake();
  adbShell(
    "input",
    "swipe",
    String(x1),
    String(y1),
    String(x2),
    String(y2),
    String(duration)
  );
}

export function keyevent(code) {
  if (String(code) !== "224") {
    ensureScreenAwake();
  }
  adbShell("input", "keyevent", String(code));
}

export function inputAscii(text) {
  ensureScreenAwake();
  const escaped = text
    .replace(/ /g, "%s")
    .replace(/[()&<>|;'"\\]/g, "");
  adbShell("input", "text", escaped);
}

export function push(localPath, remotePath) {
  adb("push", resolve(localPath), remotePath);
}

export function pull(remotePath, localPath) {
  mkdirSync(dirname(resolve(localPath)), { recursive: true });
  adb("pull", remotePath, resolve(localPath));
}

export function mediaScan(remotePath) {
  adbShell(
    "am",
    "broadcast",
    "-a",
    "android.intent.action.MEDIA_SCANNER_SCAN_FILE",
    "-d",
    `file://${remotePath}`
  );
}

export function startImageShare(remotePath, extras = {}) {
  ensureScreenAwake();
  const args = [
    "shell",
    "am",
    "start",
    "-a",
    "android.intent.action.SEND",
    "-t",
    "image/png",
    "-n",
    "com.xingin.xhs/.routers.RouterPageActivity",
    "--eu",
    "android.intent.extra.STREAM",
    `file://${remotePath}`,
    "-f",
    "1"
  ];

  if (extras.subject) {
    args.push("--es", "android.intent.extra.SUBJECT", extras.subject);
  }

  if (extras.text) {
    args.push("--es", "android.intent.extra.TEXT", extras.text);
  }

  return run(args);
}

export function openDeepLink(url, packageName = "com.xingin.xhs") {
  ensureScreenAwake();
  return run([
    "shell",
    "am",
    "start",
    "-a",
    "android.intent.action.VIEW",
    "-d",
    url,
    packageName
  ]);
}

export function broadcast(action, extras = {}) {
  const args = ["shell", "am", "broadcast", "-a", action];

  for (const [key, value] of Object.entries(extras)) {
    args.push("--es", key, value);
  }

  return run(args);
}

export function getCurrentInputMethod() {
  return adbShell("settings", "get", "secure", "default_input_method");
}

export function setInputMethod(imeId) {
  adbShell("ime", "enable", imeId);
  adbShell("ime", "set", imeId);
}

export function inputUnicodeAdbKeyboard(text) {
  ensureScreenAwake();
  const base64 = Buffer.from(text, "utf8").toString("base64");
  broadcast("ADB_INPUT_B64", { msg: base64 });
}

export function dumpUiXml(localPath) {
  ensureScreenAwake();
  adbShell("uiautomator", "dump", "/sdcard/window_dump.xml");
  mkdirSync(dirname(resolve(localPath)), { recursive: true });
  adb("pull", "/sdcard/window_dump.xml", resolve(localPath));
}

export function screenshot(localPath) {
  ensureScreenAwake();
  mkdirSync(dirname(resolve(localPath)), { recursive: true });
  const result = spawnSync(
    "/bin/zsh",
    ["-lc", buildAdbCommand(["exec-out", "screencap", "-p"])],
    {
      env: buildEnv(),
      encoding: null,
      maxBuffer: 20 * 1024 * 1024
    }
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`adb exec-out screencap failed with code ${result.status}`);
  }

  writeFileSync(resolve(localPath), result.stdout);
}

export function currentTopActivity() {
  return adbShell(
    "sh",
    "-c",
    "dumpsys window windows | egrep 'mCurrentFocus|mFocusedApp'"
  );
}

export function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}
