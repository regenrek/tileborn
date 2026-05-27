#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT_PATH="scripts/clean-checkout-smoke.sh"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/tileborne-clean-checkout.XXXXXX")"
MODE="smoke"
CDP_PORT=9323
# Cold-start profiling (2026-05-23): dev:cdp CDP /json/version ready ~20.2s on fresh rsync tree;
# pnpm -w typecheck after bootstrap ~79s on fresh rsync tree (Mac dev).
CDP_READY_LIMIT_MS=30000
DEV_CDP_PID=""
PORT_WAS_BUSY=0
TOTAL_START_MS=0

LIMIT_INSTALL_MS=90000
LIMIT_BOOTSTRAP_MS=90000
LIMIT_TYPECHECK_MS=90000
LIMIT_BUILD_MS=90000
LIMIT_TOTAL_MS=300000

declare -a STEP_NAMES=()
declare -a STEP_EXIT_CODES=()
declare -a STEP_DURATIONS=()
declare -a STEP_LIMITS=()
declare -a STEP_PASSED=()

usage() {
  cat <<'EOF'
Usage: scripts/clean-checkout-smoke.sh [--time]

  (default) Full clean-checkout smoke: install, bootstrap builds, docs, tests, boundaries.
  --time    Contributor timing smoke: install, bootstrap build, typecheck (no desktop), build, dev:cdp ready, total < 5 min.
EOF
}

now_ms() {
  python3 -c 'import time; print(int(time.time() * 1000))'
}

format_duration() {
  local ms="$1"
  python3 - "$ms" <<'PY'
import sys
ms = int(sys.argv[1])
seconds, millis = divmod(ms, 1000)
minutes, seconds = divmod(seconds, 60)
if minutes:
    print(f"{minutes}m {seconds}s")
else:
    print(f"{seconds}.{millis // 100:01d}s")
PY
}

record_step() {
  local name="$1"
  local exit_code="$2"
  local duration_ms="$3"
  local limit_ms="$4"
  local passed="$5"

  STEP_NAMES+=("$name")
  STEP_EXIT_CODES+=("$exit_code")
  STEP_DURATIONS+=("$duration_ms")
  STEP_LIMITS+=("$limit_ms")
  STEP_PASSED+=("$passed")
}

run_timed_step() {
  local name="$1"
  local limit_ms="$2"
  shift 2

  echo "==> $name"
  local start_ms end_ms duration_ms exit_code passed
  start_ms="$(now_ms)"
  set +e
  "$@"
  exit_code=$?
  set -e
  end_ms="$(now_ms)"
  duration_ms=$((end_ms - start_ms))
  passed="true"
  if (( exit_code != 0 )) || (( duration_ms > limit_ms )); then
    passed="false"
  fi
  record_step "$name" "$exit_code" "$duration_ms" "$limit_ms" "$passed"
  echo "    duration=$(format_duration "$duration_ms") limit=$(format_duration "$limit_ms") exit=$exit_code"
  return 0
}

stage_clean_tree() {
  echo "==> clean-checkout: staging tree at $WORK_DIR"
  rsync -a \
    --exclude node_modules \
    --exclude dist \
    --exclude .turbo \
    --exclude .vite \
    --exclude .plandb \
    --exclude .git \
    --exclude '*.tsbuildinfo' \
    "$ROOT/" "$WORK_DIR/"
  find "$WORK_DIR" -name '*.tsbuildinfo' -delete 2>/dev/null || true
  cd "$WORK_DIR"
}

kill_port_listeners() {
  local pids=""
  if command -v lsof >/dev/null 2>&1; then
    pids="$(lsof -ti :"$CDP_PORT" 2>/dev/null || true)"
  fi
  if [[ -n "$pids" ]]; then
    kill $pids 2>/dev/null || true
    sleep 1
  fi
}

port_is_busy() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -ti :"$CDP_PORT" >/dev/null 2>&1
    return $?
  fi
  python3 - "$CDP_PORT" <<'PY'
import socket, sys
port = int(sys.argv[1])
sock = socket.socket()
sock.settimeout(0.2)
try:
    sock.connect(("127.0.0.1", port))
    raise SystemExit(0)
except OSError:
    raise SystemExit(1)
finally:
    sock.close()
PY
}

wait_for_cdp_ready() {
  local start_ms="$1"
  local limit_ms="$2"
  while true; do
    if curl -sf "http://127.0.0.1:${CDP_PORT}/json/version" >/dev/null 2>&1; then
      echo "    CDP ready on port ${CDP_PORT}"
      return 0
    fi
    local now_ms elapsed_ms
    now_ms="$(now_ms)"
    elapsed_ms=$((now_ms - start_ms))
    if (( elapsed_ms >= limit_ms )); then
      echo "    CDP not ready within $(format_duration "$limit_ms")"
      return 1
    fi
    sleep 0.25
  done
}

launch_dev_cdp() {
  local launch_cmd=(pnpm --filter @tileborne/desktop dev:cdp)
  if [[ "$(uname -s)" == "Linux" ]] && [[ -z "${DISPLAY:-}" ]]; then
    launch_cmd=(xvfb-run -a "${launch_cmd[@]}")
  fi
  "${launch_cmd[@]}" &
  DEV_CDP_PID=$!
}

teardown_dev_cdp() {
  if [[ -n "$DEV_CDP_PID" ]]; then
    kill "$DEV_CDP_PID" 2>/dev/null || true
    pkill -P "$DEV_CDP_PID" 2>/dev/null || true
    wait "$DEV_CDP_PID" 2>/dev/null || true
    DEV_CDP_PID=""
  fi
  kill_port_listeners
}

restore_dev_cdp() {
  if [[ "$PORT_WAS_BUSY" != "1" ]] || [[ "${CI:-}" == "true" ]]; then
    return 0
  fi
  echo "==> restoring dev:cdp on port ${CDP_PORT}"
  cd "$ROOT"
  pnpm --filter @tileborne/desktop dev:cdp >/dev/null 2>&1 &
  disown || true
}

run_smoke_checks() {
  stage_clean_tree

  echo "==> pnpm install --frozen-lockfile"
  pnpm install --frozen-lockfile

  echo "==> bootstrap package builds (composite references)"
  pnpm turbo run build --filter='!@tileborne/docs'

  echo "==> pnpm turbo run typecheck --filter=!@tileborne/desktop"
  pnpm turbo run typecheck --filter='!@tileborne/desktop'

  echo "==> build CLI for docs prebuild (test phase)"
  pnpm turbo run build --filter=@tileborne/cli...

  echo "==> pnpm docs:build"
  pnpm docs:build

  echo "==> pnpm -w test -- --run"
  pnpm -w test -- --run

  echo "==> pnpm -w build"
  pnpm -w build

  echo "==> pnpm test:boundaries"
  pnpm test:boundaries

  echo "==> clean-checkout smoke passed"
}

run_time_checks() {
  TOTAL_START_MS="$(now_ms)"
  stage_clean_tree

  run_timed_step "pnpm install --frozen-lockfile" "$LIMIT_INSTALL_MS" pnpm install --frozen-lockfile
  run_timed_step "bootstrap package builds (composite references)" "$LIMIT_BOOTSTRAP_MS" \
    pnpm turbo run build --filter='!@tileborne/docs'
  run_timed_step "pnpm turbo run typecheck --filter=!@tileborne/desktop" "$LIMIT_TYPECHECK_MS" \
    pnpm turbo run typecheck --filter='!@tileborne/desktop'
  run_timed_step "pnpm -w build" "$LIMIT_BUILD_MS" pnpm -w build

  if port_is_busy; then
    PORT_WAS_BUSY=1
    echo "==> freeing port ${CDP_PORT} before dev:cdp timing"
    kill_port_listeners
  fi

  local dev_step_name="pnpm --filter @tileborne/desktop dev:cdp"
  echo "==> $dev_step_name"
  local dev_start_ms dev_end_ms dev_duration_ms dev_exit_code dev_passed
  dev_start_ms="$(now_ms)"
  dev_exit_code=0
  launch_dev_cdp
  if ! wait_for_cdp_ready "$dev_start_ms" "$CDP_READY_LIMIT_MS"; then
    dev_exit_code=1
  fi
  teardown_dev_cdp
  restore_dev_cdp
  dev_end_ms="$(now_ms)"
  dev_duration_ms=$((dev_end_ms - dev_start_ms))
  dev_passed="true"
  if (( dev_exit_code != 0 )) || (( dev_duration_ms > CDP_READY_LIMIT_MS )); then
    dev_passed="false"
  fi
  record_step "$dev_step_name" "$dev_exit_code" "$dev_duration_ms" "$CDP_READY_LIMIT_MS" "$dev_passed"
  echo "    duration=$(format_duration "$dev_duration_ms") limit=$(format_duration "$CDP_READY_LIMIT_MS") exit=$dev_exit_code"

  local total_end_ms total_ms overall_passed
  total_end_ms="$(now_ms)"
  total_ms=$((total_end_ms - TOTAL_START_MS))
  overall_passed="true"

  for passed in "${STEP_PASSED[@]}"; do
    if [[ "$passed" != "true" ]]; then
      overall_passed="false"
    fi
  done
  if (( total_ms > LIMIT_TOTAL_MS )); then
    overall_passed="false"
  fi

  emit_time_summary "$total_ms" "$overall_passed"

  if [[ "$overall_passed" != "true" ]]; then
    echo "==> clean-checkout time smoke failed"
    return 1
  fi

  echo "==> clean-checkout time smoke passed"
}

emit_time_summary() {
  local total_ms="$1"
  local overall_passed="$2"
  local json_file="$WORK_DIR/clean-checkout-time.json"
  local steps_file="$WORK_DIR/steps.tsv"

  : >"$steps_file"
  local index
  for index in "${!STEP_NAMES[@]}"; do
    printf '%s\t%s\t%s\t%s\t%s\n' \
      "${STEP_NAMES[$index]}" \
      "${STEP_EXIT_CODES[$index]}" \
      "${STEP_DURATIONS[$index]}" \
      "${STEP_LIMITS[$index]}" \
      "${STEP_PASSED[$index]}" >>"$steps_file"
  done

  python3 - "$json_file" "$steps_file" "$SCRIPT_PATH" "$total_ms" "$LIMIT_TOTAL_MS" "$overall_passed" <<'PY'
import json
import sys

out_path, steps_path, script_path, total_ms, total_limit_ms, overall_passed = sys.argv[1:7]
steps = []
with open(steps_path, encoding="utf-8") as handle:
    for line in handle:
        name, exit_code, duration_ms, limit_ms, passed = line.rstrip("\n").split("\t")
        steps.append(
            {
                "name": name,
                "exitCode": int(exit_code),
                "durationMs": int(duration_ms),
                "limitMs": int(limit_ms),
                "passed": passed == "true",
            }
        )

report = {
    "scriptPath": script_path,
    "mode": "time",
    "totalMs": int(total_ms),
    "totalLimitMs": int(total_limit_ms),
    "passed": overall_passed == "true",
    "steps": steps,
}

with open(out_path, "w", encoding="utf-8") as handle:
    json.dump(report, handle, indent=2)
    handle.write("\n")

print(json.dumps(report, indent=2))
PY

  local report_json
  report_json="$(cat "$json_file")"

  echo
  echo "## Clean checkout time smoke"
  echo
  echo "| Step | Duration | Limit | Exit | Status |"
  echo "| --- | ---: | ---: | ---: | :--- |"
  python3 - "$json_file" <<'PY'
import json
import sys

def fmt(ms: int) -> str:
    seconds, millis = divmod(ms, 1000)
    minutes, seconds = divmod(seconds, 60)
    if minutes:
        return f"{minutes}m {seconds}s"
    if seconds:
        return f"{seconds}.{millis // 100:01d}s"
    return f"{millis}ms"

with open(sys.argv[1], encoding="utf-8") as handle:
    report = json.load(handle)

for step in report["steps"]:
    status = "pass" if step["passed"] and step["exitCode"] == 0 else "fail"
    print(
        f"| `{step['name']}` | {fmt(step['durationMs'])} | {fmt(step['limitMs'])} | "
        f"{step['exitCode']} | {status} |"
    )

total_status = "pass" if report["passed"] else "fail"
print(
    f"| **Total** | **{fmt(report['totalMs'])}** | **{fmt(report['totalLimitMs'])}** | "
    f"— | **{total_status}** |"
)
PY
  echo
  echo "CLEAN_CHECKOUT_TIME_JSON_BEGIN"
  echo "$report_json"
  echo "CLEAN_CHECKOUT_TIME_JSON_END"
}

cleanup() {
  teardown_dev_cdp
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

for arg in "$@"; do
  case "$arg" in
    --time)
      MODE="time"
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ "$MODE" == "time" ]]; then
  run_time_checks
else
  run_smoke_checks
fi
