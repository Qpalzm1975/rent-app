#!/usr/bin/env bash
# Runs one CI step and keeps its output. On failure, the last lines become a
# GitHub annotation, so the cause is readable from the checks API without logs.
set -uo pipefail
name="$1"; shift
log="$(mktemp)"
"$@" 2>&1 | tee "$log"
status=${PIPESTATUS[0]}
if [ "$status" -ne 0 ]; then
  message="$(tail -n 60 "$log" | sed -e 's/\x1b\[[0-9;]*[A-Za-z]//g' -e 's/\r//g' -e 's/%/%25/g' | awk 'BEGIN{ORS="%0A"}{print}')"
  echo "::error title=${name} failed (exit ${status})::${message}"
fi
exit "$status"
