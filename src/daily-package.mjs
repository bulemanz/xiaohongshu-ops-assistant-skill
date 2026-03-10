import { readdirSync } from "node:fs";
import { POSTS_DIR, DEFAULTS } from "./config.mjs";
import { buildPostPackage } from "./content.mjs";
import { createCoverAssets } from "./cover.mjs";
import { fetchHotRepos } from "./github-hot.mjs";
import { ensureTrendStudy } from "./study-xhs.mjs";
import { dateKey, ensureDir, fileExists, readJson, writeJson, writeText } from "./utils.mjs";

function postDir(dayKey) {
  return `${POSTS_DIR}/${dayKey}`;
}

function slotSuffix(slot) {
  return slot ? `-${slot}` : "";
}

function packagePath(dir, slot) {
  return `${dir}/post-package${slotSuffix(slot)}.json`;
}

function markdownPath(dir, slot) {
  return `${dir}/post${slotSuffix(slot)}.md`;
}

function listPackagePaths(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^post-package(?:-\d{4})?\.json$/.test(entry.name))
    .map((entry) => `${dir}/${entry.name}`)
    .sort();
}

function recentRepoNames(dayKey, windowSize = 3) {
  const dayDirs = readdirSync(POSTS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name) && name < dayKey)
    .sort()
    .slice(-windowSize);

  const names = new Set();
  for (const dir of dayDirs) {
    const fullDir = `${POSTS_DIR}/${dir}`;
    if (!fileExists(fullDir)) continue;
    for (const existingPackagePath of listPackagePaths(fullDir)) {
      const postPackage = readJson(existingPackagePath, null);
      if (postPackage?.repo?.fullName) {
        names.add(postPackage.repo.fullName);
      }
    }
  }
  return names;
}

function chooseRepo(repos, dayKey) {
  const recentNames = recentRepoNames(dayKey);
  const preferred = repos.filter((repo) => /TypeScript|Python|Go|Rust/.test(repo.language || ""));
  const preferredUnused = preferred.find((repo) => !recentNames.has(repo.fullName));
  if (preferredUnused) return preferredUnused;

  const anyUnused = repos.find((repo) => !recentNames.has(repo.fullName));
  if (anyUnused) return anyUnused;

  return preferred[0] || repos[0];
}

export async function ensureDailyPackage(options = {}) {
  const timeZone = options.timeZone || DEFAULTS.timezone;
  const dayKey = options.date || dateKey(new Date(), timeZone);
  const dir = postDir(dayKey);
  const postSlot = options.slot || null;
  const targetPackagePath = packagePath(dir, postSlot);

  if (!options.force && fileExists(targetPackagePath)) {
    return readJson(targetPackagePath, null);
  }

  if (!options.force && !postSlot && fileExists(dir)) {
    const existingPackages = listPackagePaths(dir);
    if (existingPackages.length > 0) {
      return readJson(existingPackages[existingPackages.length - 1], null);
    }
  }

  ensureDir(dir);
  const trendStudy = await ensureTrendStudy({
    date: dayKey,
    timeZone,
    keyword: DEFAULTS.studyKeyword,
    force: options.force,
    offline: options.offline
  }).catch(() => null);
  const repos = await fetchHotRepos({
    timeZone,
    force: options.force,
    offline: options.offline
  });

  const repo = chooseRepo(repos, dayKey);
  const postPackage = await buildPostPackage(repo, { trendStudy });
  const cover = await createCoverAssets(postPackage, postSlot ? `${dayKey}-${postSlot}` : dayKey);
  const fullPackage = {
    ...postPackage,
    dateKey: dayKey,
    slot: postSlot,
    trendStudy: trendStudy
      ? {
          keyword: trendStudy.keyword,
          brief: trendStudy.brief,
          recentHotSamples: trendStudy.recentHotSamples
        }
      : null,
    cover
  };

  writeJson(targetPackagePath, fullPackage);
  writeText(
    markdownPath(dir, postSlot),
    `# ${fullPackage.title}\n\n${fullPackage.body}\n`
  );

  return fullPackage;
}
