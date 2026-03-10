import { spawnSync } from "node:child_process";
import { REMOTE } from "./config.mjs";

function escapeSingleQuotes(text) {
  return text.replace(/'/g, "'\"'\"'");
}

function applyTemplate(template, replacements) {
  return template.replace(/\{([A-Z0-9_]+)\}/g, (_, key) => replacements[key] || "");
}

function runRemote(command) {
  const result = spawnSync(
    "gcloud",
    [
      "compute",
      "ssh",
      "--zone",
      REMOTE.zone,
      REMOTE.instance,
      "--project",
      REMOTE.project,
      "--command",
      command
    ],
    {
      encoding: "utf8"
    }
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "gcloud compute ssh failed").trim());
  }

  return (result.stdout || "").trim();
}

export function remoteTextRefine(prompt, fallbackText) {
  if (!REMOTE.enabled || !REMOTE.textTemplate) {
    return fallbackText;
  }

  try {
    const output = runRemote(
      applyTemplate(REMOTE.textTemplate, {
        PROMPT: escapeSingleQuotes(prompt),
        PROMPT_B64: Buffer.from(prompt, "utf8").toString("base64")
      })
    );

    return output || fallbackText;
  } catch {
    return fallbackText;
  }
}

export function remoteImageBase64(prompt) {
  if (!REMOTE.enabled || !REMOTE.imageTemplate) {
    return null;
  }

  try {
    const output = runRemote(
      applyTemplate(REMOTE.imageTemplate, {
        PROMPT: escapeSingleQuotes(prompt),
        PROMPT_B64: Buffer.from(prompt, "utf8").toString("base64")
      })
    );

    return output || null;
  } catch {
    return null;
  }
}
