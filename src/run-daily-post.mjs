import { pathToFileURL } from "node:url";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULTS } from "./config.mjs";
import { ensureDailyPackage } from "./daily-package.mjs";
import { XiaohongshuAutomation } from "./xhs.mjs";

function parseArgs(argv) {
  return {
    device: process.env.XHS_DEVICE_PROFILE || DEFAULTS.device,
    date: argv.includes("--date")
      ? argv[argv.indexOf("--date") + 1]
      : undefined,
    slot: argv.includes("--slot")
      ? argv[argv.indexOf("--slot") + 1]
      : undefined,
    force: argv.includes("--force"),
    offline: argv.includes("--offline"),
    publish: argv.includes("--publish"),
    saveDraft: argv.includes("--save-draft"),
    dryRun: argv.includes("--dry-run"),
    outputDir: argv.includes("--output-dir")
      ? resolve(argv[argv.indexOf("--output-dir") + 1])
      : resolve("artifacts", "runs", new Date().toISOString().replaceAll(":", "-")),
    textMode: argv.includes("--text-mode")
      ? argv[argv.indexOf("--text-mode") + 1]
      : process.env.XHS_TEXT_MODE || "adb-keyboard"
  };
}

export async function runDailyPost(options = {}) {
  const outputDir =
    options.outputDir ||
    resolve("artifacts", "runs", new Date().toISOString().replaceAll(":", "-"));
  const postPackage = await ensureDailyPackage(options);

  if (options.dryRun) {
    return {
      mode: "dry-run",
      postPackage
    };
  }

  mkdirSync(outputDir, { recursive: true });

  const xhs = new XiaohongshuAutomation(options.device || DEFAULTS.device);
  await xhs.openEditorWithImage(resolve(postPackage.cover.pngPath), outputDir);
  await xhs.fillTitleAndBody({
    title: postPackage.title,
    body: postPackage.body,
    textMode: options.textMode || "adb-keyboard",
    outputDir
  });

  if (options.publish) {
    await xhs.publish(outputDir);
  } else if (options.saveDraft) {
    await xhs.saveDraft(outputDir);
  }

  return {
    mode: options.publish ? "publish" : options.saveDraft ? "save-draft" : "editor-only",
    outputDir,
    postPackage
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await runDailyPost(args);
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
