import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

export function ensureDir(path) {
  mkdirSync(resolve(path), { recursive: true });
}

export function fileExists(path) {
  return existsSync(resolve(path));
}

export function readJson(path, fallback = null) {
  try {
    return JSON.parse(readFileSync(resolve(path), "utf8"));
  } catch {
    return fallback;
  }
}

export function writeJson(path, data) {
  ensureDir(dirname(resolve(path)));
  writeFileSync(resolve(path), JSON.stringify(data, null, 2));
}

export function writeText(path, text) {
  ensureDir(dirname(resolve(path)));
  writeFileSync(resolve(path), text);
}

export function nowIso() {
  return new Date().toISOString();
}

export function dateKey(date = new Date(), timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  const map = Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value])
  );

  return `${map.year}-${map.month}-${map.day}`;
}

export function timeParts(date = new Date(), timeZone) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit"
  }).formatToParts(date);

  const map = Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value])
  );

  return {
    hour: Number(map.hour),
    minute: Number(map.minute)
  };
}

export function minutesSinceMidnight(date = new Date(), timeZone) {
  const { hour, minute } = timeParts(date, timeZone);
  return hour * 60 + minute;
}

export function isoDateDaysAgo(daysBack, date = new Date(), timeZone = "UTC") {
  const localKey = dateKey(date, timeZone);
  const utcDate = new Date(`${localKey}T00:00:00Z`);
  utcDate.setUTCDate(utcDate.getUTCDate() - daysBack);
  return utcDate.toISOString().slice(0, 10);
}

export function clip(text, maxLength) {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}

export function squeezeWhitespace(text) {
  return text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

export function wrapText(text, maxChars) {
  const lines = [];
  let line = "";

  for (const char of text) {
    if (char === "\n") {
      if (line) lines.push(line);
      line = "";
      continue;
    }

    line += char;
    if (line.length >= maxChars) {
      lines.push(line);
      line = "";
    }
  }

  if (line) lines.push(line);
  return lines;
}

export function escapeXml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function hashText(text) {
  return createHash("sha1").update(text).digest("hex");
}
