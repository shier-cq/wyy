#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${PROJECT_DIR:-$SCRIPT_DIR}"

read -r -p "Task key, for example user1: " task_key
read -r -p "Netease phone/account: " phone
read -r -s -p "Netease password: " password
printf "\n"

if [ -z "$task_key" ] || [ -z "$phone" ] || [ -z "$password" ]; then
  echo "task key, phone/account, and password are required" >&2
  exit 1
fi

json_payload="$(TASK_PHONE="$phone" TASK_PASSWORD="$password" python3 - <<'PY'
import json
import os

print(json.dumps({
    "phone": os.environ["TASK_PHONE"],
    "password": os.environ["TASK_PASSWORD"],
}, ensure_ascii=False))
PY
)"

sudo docker exec netease-musician-redis redis-cli -n 5 HSET netease:music:task "$task_key" "$json_payload" >/dev/null
echo "Saved task '$task_key' to Redis key netease:music:task."
echo "Run now with: cd ${PROJECT_DIR:-$SCRIPT_DIR} && sudo docker compose exec netease-musician-task python main.py --once"
