#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_FILE="${HALFTRACK_DATA_FILE:-$HOME/Documents/Sync/halftrack.json}"
LEGACY_DB="${HALFTRACK_LEGACY_DB:-$HOME/Documents/Sync/halftrack.db}"
SESSION_DIR="${HALFTRACK_SESSION_DIR:-$ROOT/.halftrack/sessions}"
MODEL="${HALFTRACK_MODEL:-openai-codex/gpt-5.6-luna}"

if ! command -v pi >/dev/null 2>&1; then
  printf 'halftrack: pi is not installed or not on PATH\n' >&2
  exit 127
fi

mkdir -p "$SESSION_DIR"

export HALFTRACK_DATA_FILE="$DATA_FILE"
export HALFTRACK_LEGACY_DB="$LEGACY_DB"
export HALFTRACK_SKILLS_DIR="$ROOT/trainer/skills"

exec pi \
  --model "$MODEL" \
  --system-prompt "$(<"$ROOT/trainer/SYSTEM.md")" \
  --no-context-files \
  --no-builtin-tools \
  --no-extensions \
  --extension "$ROOT/trainer/extensions/halftrack.ts" \
  --no-skills \
  --skill "$ROOT/trainer/skills/workout-tracking" \
  --no-prompt-templates \
  --no-themes \
  --session-dir "$SESSION_DIR" \
  --name "Halftrack" \
  "$@"
