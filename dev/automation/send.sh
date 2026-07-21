#!/usr/bin/env bash
# Send a JSON automation command to a running Abyssfin instance.
set -euo pipefail

CMD="${1:-}"
if [ -z "$CMD" ]; then
  echo "Usage: $0 <cmd> [key=value ...]" >&2
  echo "Examples:" >&2
  echo "  $0 play_pause" >&2
  echo "  $0 pip" >&2
  echo "  $0 seek position_ms=120000" >&2
  echo "  $0 volume level=25" >&2
  exit 1
fi

PROFILE="${ABYSSFIN_PROFILE:-default}"
RUNTIME_DIR="${XDG_RUNTIME_DIR:-${TMPDIR:-/tmp}}"
SOCKET="${RUNTIME_DIR}/abyssfin.${PROFILE}.input"

if [ ! -S "$SOCKET" ] && [ "$(uname)" = "Darwin" ]; then
  SOCKET="${TMPDIR:-/tmp}/abyssfin.${PROFILE}.input"
fi

PAYLOAD="{\"cmd\":\"${CMD}\""
shift || true
for ARG in "$@"; do
  KEY="${ARG%%=*}"
  VALUE="${ARG#*=}"
  PAYLOAD+=",\"${KEY}\":"
  if [[ "$VALUE" =~ ^-?[0-9]+$ ]]; then
    PAYLOAD+="${VALUE}"
  else
    PAYLOAD+="\"${VALUE}\""
  fi
done
PAYLOAD+="}"

printf '%s\r\n' "$PAYLOAD" | nc -U "$SOCKET"
