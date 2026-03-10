import { CACHE_DIR, DEFAULTS } from "./config.mjs";
import {
  dateKey,
  fileExists,
  isoDateDaysAgo,
  readJson,
  writeJson
} from "./utils.mjs";

const CACHE_PATH = `${CACHE_DIR}/github-hot.json`;

function fallbackRepos() {
  return [
    {
      fullName: "openclaw/openclaw",
      name: "openclaw",
      description: "Agentic CLI workflows for coding and operations.",
      stars: 1200,
      language: "TypeScript",
      url: "https://github.com/openclaw/openclaw",
      topics: ["agent", "cli", "workflow"]
    },
    {
      fullName: "astral-sh/uv",
      name: "uv",
      description: "Fast Python package and project manager.",
      stars: 42000,
      language: "Rust",
      url: "https://github.com/astral-sh/uv",
      topics: ["python", "tooling", "developer-experience"]
    },
    {
      fullName: "langgenius/dify",
      name: "dify",
      description: "LLM app development platform with workflow building.",
      stars: 78000,
      language: "TypeScript",
      url: "https://github.com/langgenius/dify",
      topics: ["llm", "workflow", "apps"]
    }
  ];
}

function normalizeRepo(item) {
  return {
    fullName: item.full_name,
    name: item.name,
    description: item.description || "",
    stars: item.stargazers_count,
    language: item.language || "Unknown",
    url: item.html_url,
    topics: item.topics || []
  };
}

export async function fetchHotRepos(options = {}) {
  const timeZone = options.timeZone || DEFAULTS.timezone;
  const daysBack = options.daysBack || DEFAULTS.githubWindowDays;
  const perPage = options.perPage || DEFAULTS.githubPerPage;
  const today = dateKey(new Date(), timeZone);
  const cached = readJson(CACHE_PATH, null);

  if (!options.force && cached?.dateKey === today && Array.isArray(cached.items)) {
    return cached.items;
  }

  if (options.offline) {
    const items = fallbackRepos();
    writeJson(CACHE_PATH, { dateKey: today, items, offline: true });
    return items;
  }

  const since = isoDateDaysAgo(daysBack, new Date(), timeZone);
  const url = new URL("https://api.github.com/search/repositories");
  url.searchParams.set("q", `created:>=${since}`);
  url.searchParams.set("sort", "stars");
  url.searchParams.set("order", "desc");
  url.searchParams.set("per_page", String(perPage));

  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "xhs-automation"
  };

  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  try {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`GitHub API ${response.status}`);
    }

    const payload = await response.json();
    const items = (payload.items || []).map(normalizeRepo);
    writeJson(CACHE_PATH, { dateKey: today, items, offline: false });
    return items;
  } catch {
    if (fileExists(CACHE_PATH)) {
      return readJson(CACHE_PATH, { items: fallbackRepos() }).items;
    }

    const items = fallbackRepos();
    writeJson(CACHE_PATH, { dateKey: today, items, offline: true });
    return items;
  }
}
