# Halftrack agent guide

## Project

Halftrack is a local personal-trainer application built on Pi. It is not a conventional CLI or a Python package.

- Launcher: `halftrack.sh`
- System prompt: `trainer/SYSTEM.md`
- Tracking skill: `trainer/skills/workout-tracking/SKILL.md`
- Pi extension: `trainer/extensions/halftrack.ts`
- JSON storage logic: `trainer/lib/storage.mjs`
- Storage tests: `tests/storage.test.mjs`
- Default data: `~/Documents/Sync/halftrack.json`

The launcher must remain isolated from normal coding-agent resources. It disables discovered context, built-in tools, extensions, skills, prompts, and themes, then explicitly loads only Halftrack resources. Do not set a separate `PI_CODING_AGENT_DIR`; Halftrack intentionally reuses the user's existing Pi authentication. Its default model is `openai-codex/gpt-5.6-luna`, overridable with `HALFTRACK_MODEL`.

## Storage

Keep persisted data in human-readable JSON using schema version 1. Store one visit or training session as a workout containing one or more activities. Preserve stable positive integer workout IDs. Store durations canonically as seconds and dates as ISO `YYYY-MM-DD` local calendar dates.

All file mutations must use atomic writes and Pi's `withFileMutationQueue()` to prevent concurrent tool calls from losing data. Keep the one-time SQLite migration nondestructive: import only when the JSON file does not exist, and never modify or remove the old database.

## Tools and prompts

Keep data validation, querying, and calculations in `trainer/lib/storage.mjs`. Keep tool schemas, Pi lifecycle behavior, confirmations, and terminal integration in `trainer/extensions/halftrack.ts`. Keep tracking policy and natural-language interpretation in the skill rather than duplicating it throughout tool descriptions.

The model must not have general shell or file-writing tools. The skill loader may read only Markdown under `trainer/skills/`. Routine tool calls stay hidden when tool output is collapsed and remain inspectable with Pi's expand-tools control. Deletions must always use an interactive confirmation from the extension and must fail closed without UI.

Weekly mileage uses Monday through Sunday and includes zero-mile weeks. Running pace is duration divided by miles and displayed as `M:SS /mi`.

## Validation

After changes, run:

```sh
node --test tests/storage.test.mjs
```

Also launch `./halftrack.sh --list-models` with `HALFTRACK_DATA_FILE` pointed at a temporary directory to verify that Pi can load the extension without touching personal data.
