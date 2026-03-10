import { pathToFileURL } from "node:url";
import {
  geminiGenerateImageBase64,
  geminiGeneratePost,
  geminiProbeImagePayload
} from "./gemini.mjs";

const SAMPLE_REPO = {
  name: "openclaw",
  fullName: "openclaw/openclaw",
  description: "An automation-first open source workflow runner for daily developer tasks.",
  language: "TypeScript",
  url: "https://github.com/openclaw/openclaw"
};

async function main() {
  const fallbackPackage = {
    title: "OpenClaw 选题：openclaw",
    body: "这是一个本地 fallback 草稿，用来验证 Gemini 是否能接管文案生成。",
    hashtags: "#OpenClaw #GitHub热门 #开源项目 #效率工具 #TypeScript",
    commentSeed: "如果你想看命令流拆解，我下一篇可以继续。",
    repo: SAMPLE_REPO
  };

  const mode = process.argv.includes("--image-raw")
    ? "image-raw"
    : process.argv.includes("--image")
      ? "image"
      : "text";

  if (mode === "image-raw") {
    const result = await geminiProbeImagePayload(
      "请生成一张适合中文科技图文平台的 3:4 封面图，主题是 OpenClaw 与 GitHub 热门项目。"
    );
    console.log(JSON.stringify({ mode, result }, null, 2));
    return;
  }

  if (mode === "image") {
    const image = await geminiGenerateImageBase64(
      "请生成一张适合中文科技图文平台的 3:4 封面图，主题是 OpenClaw 与 GitHub 热门项目。"
    );
    console.log(
      JSON.stringify(
        {
          mode,
          ok: Boolean(image),
          bytes: image ? Buffer.from(image, "base64").length : 0
        },
        null,
        2
      )
    );
    return;
  }

  const post = await geminiGeneratePost(SAMPLE_REPO, fallbackPackage);
  console.log(JSON.stringify({ mode, ok: Boolean(post), post }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
