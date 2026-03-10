import { pathToFileURL } from "node:url";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { currentTopActivity, dumpUiXml, screenshot } from "./adb.mjs";

async function main() {
  const outputDir = resolve("artifacts");
  mkdirSync(outputDir, { recursive: true });
  screenshot(`${outputDir}/probe.png`);
  dumpUiXml(`${outputDir}/probe.xml`);
  const top = currentTopActivity();
  console.log(top);
  console.log(`[xhs] wrote ${outputDir}/probe.png`);
  console.log(`[xhs] wrote ${outputDir}/probe.xml`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
