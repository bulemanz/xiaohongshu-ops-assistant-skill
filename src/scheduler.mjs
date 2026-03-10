import { DEFAULTS } from "./config.mjs";
import {
  hasPosted,
  loadState,
  markPosted,
  updateCommentSweep
} from "./state.mjs";
import { dateKey, minutesSinceMidnight } from "./utils.mjs";
import { runDailyPost } from "./run-daily-post.mjs";
import { runCommentPipeline } from "./comment-pipeline.mjs";

function parseArgs(argv) {
  return {
    publish: argv.includes("--publish"),
    autoSend: argv.includes("--auto-send"),
    comments: argv.includes("--comments") || argv.includes("--auto-send"),
    forcePost: argv.includes("--force-post"),
    forceReplies: argv.includes("--force-replies"),
    dryRun: argv.includes("--dry-run"),
    offline: argv.includes("--offline")
  };
}

function shouldSweepComments(state) {
  if (!state.lastCommentSweepAt) {
    return true;
  }

  const elapsedMs = Date.now() - new Date(state.lastCommentSweepAt).getTime();
  return elapsedMs >= DEFAULTS.commentSweepIntervalHours * 60 * 60 * 1000;
}

function postStateKey(dayKey, slotId) {
  return slotId ? `${dayKey}@${slotId}` : dayKey;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const state = loadState();
  const dayKey = dateKey(new Date(), DEFAULTS.timezone);
  const nowMinutes = minutesSinceMidnight(new Date(), DEFAULTS.timezone);
  const actions = [];

  const dueSlots = DEFAULTS.postSlots.filter((slot) => args.forcePost || nowMinutes >= slot.minutes);

  for (const slot of dueSlots) {
    const stateKey = postStateKey(dayKey, slot.id);
    if (!args.forcePost && hasPosted(state, stateKey)) {
      continue;
    }

    const result = await runDailyPost({
      slot: slot.id,
      publish: args.publish,
      dryRun: args.dryRun,
      offline: args.offline
    });
    actions.push({ type: "post", mode: result.mode, slot: slot.label });

    if (args.publish && !args.dryRun) {
      markPosted(state, stateKey, {
        title: result.postPackage.title,
        slot: slot.label
      });
    }
  }

  if (args.forceReplies || (args.comments && shouldSweepComments(state))) {
    const result = await runCommentPipeline({
      autoSend: args.autoSend,
      dryRun: args.dryRun,
      offline: args.offline
    });
    actions.push({
      type: "comments",
      sentCount: result.sentCount,
      outputPath: result.outputPath
    });

    if (!args.dryRun) {
      updateCommentSweep(state);
    }
  }

  console.log(JSON.stringify({ actions }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
