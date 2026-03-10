import { pathToFileURL } from "node:url";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { XiaohongshuAutomation } from "./xhs.mjs";

function parseArgs(argv) {
  const args = {
    device: process.env.XHS_DEVICE_PROFILE || "redmi-k80",
    image: null,
    title: "",
    body: "",
    textMode: "skip",
    outputDir: resolve("artifacts"),
    openOnly: false,
    publish: false,
    saveDraft: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    const next = argv[index + 1];

    if (value === "--image") args.image = next;
    if (value === "--title") args.title = next;
    if (value === "--body") args.body = next;
    if (value === "--device") args.device = next;
    if (value === "--text-mode") args.textMode = next;
    if (value === "--output-dir") args.outputDir = resolve(next);
    if (value === "--open-only") args.openOnly = true;
    if (value === "--publish") args.publish = true;
    if (value === "--save-draft") args.saveDraft = true;
  }

  if (!args.image) {
    throw new Error("Missing required argument: --image");
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  mkdirSync(args.outputDir, { recursive: true });

  const xhs = new XiaohongshuAutomation(args.device);
  const imagePath = resolve(args.image);

  console.log(`[xhs] using device profile: ${args.device}`);
  console.log(`[xhs] opening editor with image: ${imagePath}`);
  await xhs.openEditorWithImage(imagePath, args.outputDir);

  if (args.openOnly) {
    console.log("[xhs] stopped at editor because --open-only was set");
    return;
  }

  if (args.textMode === "ascii") {
    console.log("[xhs] filling title/body with ascii input");
    await xhs.fillTitleAndBody({
      title: args.title,
      body: args.body,
      textMode: "ascii",
      outputDir: args.outputDir
    });
  } else if (args.textMode === "adb-keyboard") {
    console.log("[xhs] filling title/body with adb keyboard input");
    await xhs.fillTitleAndBody({
      title: args.title,
      body: args.body,
      textMode: "adb-keyboard",
      outputDir: args.outputDir
    });
  } else {
    console.log(
      "[xhs] skipped text entry. Use --text-mode ascii or --text-mode adb-keyboard."
    );
  }

  if (args.publish) {
    console.log("[xhs] tapping publish");
    await xhs.publish(args.outputDir);
  } else if (args.saveDraft) {
    console.log("[xhs] tapping save draft");
    await xhs.saveDraft(args.outputDir);
  } else {
    console.log("[xhs] submit skipped. Pass --publish or --save-draft.");
  }

  console.log("[xhs] done");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
