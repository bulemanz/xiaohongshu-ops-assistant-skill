import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));
export const PROJECT_DIR = resolve(SRC_DIR, "..");
export const DATA_DIR = resolve(PROJECT_DIR, "data");
export const POSTS_DIR = resolve(DATA_DIR, "posts");
export const COMMENTS_DIR = resolve(DATA_DIR, "comments");
export const STATE_DIR = resolve(DATA_DIR, "state");
export const CACHE_DIR = resolve(DATA_DIR, "cache");
export const STUDY_DIR = resolve(DATA_DIR, "study");
export const ARTIFACTS_DIR = resolve(PROJECT_DIR, "artifacts");
export const GENERATED_DIR = resolve(ARTIFACTS_DIR, "generated");

function loadPostSlots() {
  const legacyHour = Number(process.env.XHS_POST_HOUR || 19);
  const legacyMinute = Number(process.env.XHS_POST_MINUTE || 0);
  const raw =
    process.env.XHS_POST_SLOTS ||
    (process.env.XHS_POST_HOUR || process.env.XHS_POST_MINUTE
      ? `${String(legacyHour).padStart(2, "0")}:${String(legacyMinute).padStart(2, "0")}`
      : "13:00,19:00");

  return [...new Set(raw.split(",").map((item) => item.trim()).filter(Boolean))]
    .map((item) => {
      const match = item.match(/^(\d{1,2}):(\d{2})$/);
      if (!match) {
        return null;
      }

      const hour = Number(match[1]);
      const minute = Number(match[2]);

      if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
        return null;
      }

      return {
        id: `${String(hour).padStart(2, "0")}${String(minute).padStart(2, "0")}`,
        label: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
        hour,
        minute,
        minutes: hour * 60 + minute
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.minutes - right.minutes);
}

const DEFAULT_POST_SLOTS = loadPostSlots();
const LAST_POST_SLOT = DEFAULT_POST_SLOTS[DEFAULT_POST_SLOTS.length - 1] || {
  hour: 19,
  minute: 0
};

export const DEFAULTS = {
  accountName: process.env.XHS_ACCOUNT_NAME || "default",
  device: process.env.XHS_DEVICE_PROFILE || "redmi-k80",
  timezone: process.env.XHS_TIMEZONE || "Asia/Shanghai",
  postSlots: DEFAULT_POST_SLOTS,
  postHour: Number(process.env.XHS_POST_HOUR || LAST_POST_SLOT.hour),
  postMinute: Number(process.env.XHS_POST_MINUTE || LAST_POST_SLOT.minute),
  commentSweepIntervalHours: Number(
    process.env.XHS_COMMENT_SWEEP_INTERVAL_HOURS || 2
  ),
  maxAutoRepliesPerRun: Number(process.env.XHS_MAX_AUTO_REPLIES || 3),
  githubWindowDays: Number(process.env.XHS_GITHUB_WINDOW_DAYS || 7),
  githubPerPage: Number(process.env.XHS_GITHUB_PER_PAGE || 8),
  studyKeyword: process.env.XHS_STUDY_KEYWORD || "OpenClaw",
  studyWindowDays: Number(process.env.XHS_STUDY_WINDOW_DAYS || 3),
  studyPages: Number(process.env.XHS_STUDY_PAGES || 3),
  studyMaxSamples: Number(process.env.XHS_STUDY_MAX_SAMPLES || 12)
};

export const REMOTE = {
  enabled: process.env.XHS_REMOTE_OPENCLAW === "1",
  zone: process.env.XHS_GCLOUD_ZONE || "asia-northeast1-b",
  instance: process.env.XHS_GCLOUD_INSTANCE || "your-instance",
  project:
    process.env.XHS_GCLOUD_PROJECT || "your-project-id",
  textTemplate: process.env.XHS_REMOTE_TEXT_COMMAND_TEMPLATE || "",
  imageTemplate: process.env.XHS_REMOTE_IMAGE_COMMAND_TEMPLATE || ""
};

function loadGeminiKeys() {
  const dedupe = (items) => [...new Set(items.filter(Boolean))];
  const ordered = Object.entries(process.env)
    .filter(([key, value]) => /^XHS_GEMINI_API_KEY_\d+$/.test(key) && value)
    .sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }))
    .map(([, value]) => value.trim())
    .filter(Boolean);

  if (ordered.length > 0) {
    return dedupe(ordered);
  }

  const csv = process.env.XHS_GEMINI_API_KEYS || process.env.GEMINI_API_KEYS || "";
  if (csv) {
    return dedupe(
      csv
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
    );
  }

  const single = process.env.GEMINI_API_KEY || process.env.XHS_GEMINI_API_KEY || "";
  return single ? dedupe([single.trim()]) : [];
}

export const GEMINI = {
  enabled: process.env.XHS_CONTENT_PROVIDER === "gemini" || loadGeminiKeys().length > 0,
  keys: loadGeminiKeys(),
  transport: process.env.XHS_GEMINI_TRANSPORT || "auto",
  textModels: (
    process.env.XHS_GEMINI_TEXT_MODELS ||
    process.env.XHS_GEMINI_TEXT_MODEL ||
    "gemini-3-pro-preview,gemini-2.5-pro,gemini-3-flash-preview"
  )
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
  imageModels: (
    process.env.XHS_GEMINI_IMAGE_MODELS ||
    process.env.XHS_GEMINI_IMAGE_MODEL ||
    "gemini-3-pro-image-preview,gemini-2.5-flash-image"
  )
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
  textApiVersion: process.env.XHS_GEMINI_TEXT_API_VERSION || "v1beta",
  imageApiVersion: process.env.XHS_GEMINI_IMAGE_API_VERSION || "v1beta",
  imageAspectRatio: process.env.XHS_GEMINI_IMAGE_ASPECT_RATIO || "3:4",
  remoteViaGcloud: process.env.XHS_GEMINI_REMOTE_VIA_GCLOUD !== "0"
};
