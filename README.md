# Xiaohongshu Automation

Public-ready workflow for Xiaohongshu content research, draft generation, guarded posting, and guarded comment follow-up through `adb`.

## What This Repo Includes

- `src/`: post generation, trend study, posting, and comment pipeline
- `docs/`: ops workflow tree and exported reference images
- `launchd/`: macOS scheduler template
- `scripts/`: scheduler wrapper

## What This Repo Does Not Include

- personal paths
- local secrets
- live account data
- post history, comment history, runtime state, or logs
- installed launchd files from a personal machine

## Project Layout

```text
xhs-automation-public
├── .env.example
├── .gitignore
├── README.md
├── docs
│   ├── images
│   └── ops-workflow-tree.md
├── launchd
├── scripts
├── src
├── artifacts
│   └── generated
├── data
└── logs
```

## Setup

1. Install Node.js 20+ and `adb`.
2. Copy `.env.example` to `.env` and fill in your own values.
3. Put the phone in developer mode and enable USB debugging.
4. Install an ADB-capable input method such as `ADB Keyboard` if you want stable Chinese text input.

## Environment

Core runtime variables:

- `ADB_BIN`: defaults to `adb`
- `ADB_VENDOR_KEYS`: defaults to `$HOME/.android`
- `XHS_DEVICE_PROFILE`: default `redmi-k80`
- `XHS_TIMEZONE`: default `Asia/Shanghai`
- `XHS_POST_SLOTS`: default `13:00,19:00`
- `XHS_COMMENT_SWEEP_INTERVAL_HOURS`: default `0.25`
- `XHS_MAX_AUTO_REPLIES`: default `3`
- `XHS_STUDY_KEYWORD`: default `OpenClaw`

Optional generation variables:

- `GITHUB_TOKEN`
- `XHS_GEMINI_API_KEYS`
- `XHS_GEMINI_TRANSPORT`
- `XHS_REMOTE_OPENCLAW`
- `XHS_REMOTE_TEXT_COMMAND_TEMPLATE`
- `XHS_REMOTE_IMAGE_COMMAND_TEMPLATE`

## Commands

```bash
npm run xhs:study -- --keyword OpenClaw --force
npm run xhs:generate -- --offline
npm run xhs:post-daily
npm run xhs:post-daily -- --publish
npm run xhs:comments
npm run xhs:comments -- --auto-send --max-replies 3
npm run xhs:tick -- --publish --comments
```

## Privacy And Safety Rules

- Always verify screen state before device actions.
- The same visible comment must never receive two replies.
- Replies must use thread context on follow-up comments.
- High-risk or argumentative comments should stay manual.
- This repo does not include moderation-evasion or fake-human behavior.

## Scheduler Template

The included file `launchd/com.openclaw.xhs-automation.plist.template` uses the placeholder `__WORKDIR__`. Replace it with the absolute path of your own checkout before loading it with `launchctl`.
