#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

read -r -s -p "Admin password: " ADMIN_PASSWORD
printf "\n"
read -r -p "Gemini API key (leave blank to skip): " GEMINI_API_KEY
read -r -p "Port (default 18237): " PORT

export ADMIN_PASSWORD
if [ -n "$GEMINI_API_KEY" ]; then
  export GEMINI_API_KEY
fi

if [ -z "$PORT" ]; then
  PORT=18237
fi

uv sync
uv run uvicorn server:app --host 0.0.0.0 --port "$PORT" --reload
