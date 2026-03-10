import { pathToFileURL } from "node:url";
import { ensureDailyPackage } from "./daily-package.mjs";

function parseArgs(argv) {
  return {
    date: argv.includes("--date")
      ? argv[argv.indexOf("--date") + 1]
      : undefined,
    slot: argv.includes("--slot")
      ? argv[argv.indexOf("--slot") + 1]
      : undefined,
    force: argv.includes("--force"),
    offline: argv.includes("--offline")
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const postPackage = await ensureDailyPackage(args);
  console.log(JSON.stringify(postPackage, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
