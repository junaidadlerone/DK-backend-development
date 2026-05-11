#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FUNCTIONS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)/supabase/functions"

if [[ ! -d "$FUNCTIONS_DIR" ]]; then
    echo "Error: functions directory not found at $FUNCTIONS_DIR" >&2
    exit 1
fi

deployed=0
failed=()

for dir in "$FUNCTIONS_DIR"/*/; do
    name="$(basename "$dir")"

    # Skip shared modules (any directory starting with _) and WebSocket
    [[ "$name" == _* ]] && continue
    [[ "$name" == "WebSocket" ]] && continue

    echo "==> Deploying $name"
    if supabase functions deploy "$name" --no-verify-jwt; then
        deployed=$((deployed + 1))
    else
        echo "!! Failed to deploy $name" >&2
        failed+=("$name")
    fi
done

echo
echo "Deployed: $deployed"
if (( ${#failed[@]} > 0 )); then
    echo "Failed (${#failed[@]}): ${failed[*]}" >&2
    exit 1
fi
