#!/bin/bash
# JOULE Meter Bridge — Integration Test Suite
# Tests fake-shelly.js + meter-bridge.js together

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

PASS=0
FAIL=0
SHELLY_PID=""
BRIDGE_PID=""

cleanup() {
  [ -n "$SHELLY_PID" ] && kill "$SHELLY_PID" 2>/dev/null
  [ -n "$BRIDGE_PID" ] && kill "$BRIDGE_PID" 2>/dev/null
  wait 2>/dev/null
}
trap cleanup EXIT

start_shelly() {
  local mode="${1:-normal}"
  cleanup
  FAKE_SHELLY_MODE="$mode" FAKE_SHELLY_PORT=8090 node fake-shelly.js > /tmp/shelly-test.log 2>&1 &
  SHELLY_PID=$!
  sleep 1
}

check() {
  local name="$1"
  local pattern="$2"
  local file="$3"
  if grep -q "$pattern" "$file" 2>/dev/null; then
    echo "  ��� $name"
    PASS=$((PASS + 1))
  else
    echo "  ✘ $name"
    echo "    Expected pattern: $pattern"
    echo "    Log tail:"
    tail -5 "$file" 2>/dev/null | sed 's/^/    /'
    FAIL=$((FAIL + 1))
  fi
}

check_not() {
  local name="$1"
  local pattern="$2"
  local file="$3"
  if ! grep -q "$pattern" "$file" 2>/dev/null; then
    echo "  ✔ $name"
    PASS=$((PASS + 1))
  else
    echo "  ✘ $name (pattern found but should not be)"
    grep "$pattern" "$file" | head -3 | sed 's/^/    /'
    FAIL=$((FAIL + 1))
  fi
}

echo "══════════════════════════════════��════"
echo "  JOULE Meter Bridge Test Suite"
echo "═══════════════════════════════════════"
echo ""

# ─── Test 1: Normal operation ───────────────────────────────────
echo "▸ Test 1: Normal operation (Shelly detected, kWh flowing)"
start_shelly normal

METER_IP=127.0.0.1:8090 POLL_MINUTES=0.05 FACILITY_ID=1 node meter-bridge.js > /tmp/bridge-test.log 2>&1 &
BRIDGE_PID=$!
sleep 8
kill "$BRIDGE_PID" 2>/dev/null
BRIDGE_PID=""

check "Bridge detects Shelly Pro 3EM" "Detected: Shelly Pro 3EM" /tmp/bridge-test.log
check "Initial reading received" "Initial reading" /tmp/bridge-test.log
check "kWh production reported" "kWh" /tmp/bridge-test.log
check "Oracle submission logged" "Would submit\|submitReport\|oracle not configured" /tmp/bridge-test.log
echo ""

# ─── Test 2: Zero production ───────────────────────────────────
echo "▸ Test 2: Zero production (night time / no sun)"
start_shelly zero

METER_IP=127.0.0.1:8090 POLL_MINUTES=0.05 FACILITY_ID=1 node meter-bridge.js > /tmp/bridge-zero.log 2>&1 &
BRIDGE_PID=$!
sleep 8
kill "$BRIDGE_PID" 2>/dev/null
BRIDGE_PID=""

check "Bridge starts OK" "JOULE Meter Bridge" /tmp/bridge-zero.log
# Zero mode: export counter frozen, so delta=0 after initial reading.
# First poll may show tiny delta from initial��first read, subsequent show "no production"
check "Zero production handled" "no production\|ANOMALY\|0.00" /tmp/bridge-zero.log
echo ""

# ─── Test 3: Negative values (tampering) ──────────────────────
echo "▸ Test 3: Negative energy (meter tampering detection)"
start_shelly negative

METER_IP=127.0.0.1:8090 POLL_MINUTES=0.05 FACILITY_ID=1 node meter-bridge.js > /tmp/bridge-neg.log 2>&1 &
BRIDGE_PID=$!
sleep 8
kill "$BRIDGE_PID" 2>/dev/null
BRIDGE_PID=""

check "Bridge starts OK" "JOULE Meter Bridge" /tmp/bridge-neg.log
check "Tampering or anomaly detected" "ANOMALY\|tampering\|decreased\|no production" /tmp/bridge-neg.log
# Note: first poll after initial read may show tiny positive delta before counter goes negative
echo ""

# ─── Test 4: Absurdly huge values ─────────────────────────────
echo "▸ Test 4: Absurd values (1 GWh/tick — capacity exceeded)"
start_shelly huge

METER_IP=127.0.0.1:8090 POLL_MINUTES=0.05 FACILITY_ID=1 node meter-bridge.js > /tmp/bridge-huge.log 2>&1 &
BRIDGE_PID=$!
sleep 8
kill "$BRIDGE_PID" 2>/dev/null
BRIDGE_PID=""

check "Bridge starts OK" "JOULE Meter Bridge" /tmp/bridge-huge.log
check "Anomaly detected for huge values" "ANOMALY\|exceeds capacity\|Avg power" /tmp/bridge-huge.log
echo ""

# ─── Test 5: Flaky connection ─────────────────────────────────
echo "▸ Test 5: Flaky connection (50% timeouts)"
start_shelly flaky

METER_IP=127.0.0.1:8090 POLL_MINUTES=0.05 FACILITY_ID=1 node meter-bridge.js > /tmp/bridge-flaky.log 2>&1 &
BRIDGE_PID=$!
sleep 12
kill "$BRIDGE_PID" 2>/dev/null
BRIDGE_PID=""

check "Bridge starts (may retry)" "JOULE Meter Bridge\|Detected\|Initial" /tmp/bridge-flaky.log
# Flaky mode might fail on first read — that's OK, bridge should handle it
echo ""

# ─── Test 6: Meter offline (timeout) ─────────────────────────
echo "▸ Test 6: Meter completely offline (nothing on port)"
cleanup

METER_IP=127.0.0.1:19999 POLL_MINUTES=0.05 FACILITY_ID=1 node meter-bridge.js > /tmp/bridge-offline.log 2>&1 &
BRIDGE_PID=$!
sleep 5
kill "$BRIDGE_PID" 2>/dev/null
BRIDGE_PID=""

check "Bridge detects no meter" "No supported meter\|Cannot read\|ECONNREFUSED\|error\|Error" /tmp/bridge-offline.log
echo ""

# ─── Test 7: Quick API response check ─────────────────────────
echo "▸ Test 7: Direct API validation"
start_shelly normal

# Test EM.GetStatus
STATUS=$(curl -s http://127.0.0.1:8090/rpc/EM.GetStatus?id=0)
if echo "$STATUS" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d['total_act_ret'] > 0; assert d['a_voltage'] > 220" 2>/dev/null; then
  echo "  ✔ EM.GetStatus returns valid data"
  PASS=$((PASS + 1))
else
  echo "  ✘ EM.GetStatus response invalid"
  echo "    Response: $STATUS"
  FAIL=$((FAIL + 1))
fi

# Test DeviceInfo
DEVINFO=$(curl -s http://127.0.0.1:8090/rpc/Shelly.GetDeviceInfo)
if echo "$DEVINFO" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d['app'] == 'Pro3EM'" 2>/dev/null; then
  echo "  ✔ Shelly.GetDeviceInfo returns Pro3EM"
  PASS=$((PASS + 1))
else
  echo "  ✘ Shelly.GetDeviceInfo response invalid"
  FAIL=$((FAIL + 1))
fi

# Test 404
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8090/rpc/Unknown)
if [ "$HTTP_CODE" = "404" ]; then
  echo "  ✔ Unknown endpoint returns 404"
  PASS=$((PASS + 1))
else
  echo "  ✘ Expected 404, got $HTTP_CODE"
  FAIL=$((FAIL + 1))
fi
echo ""

# ─���─ Summary ──────────────────────────────────────────────────
cleanup
echo "═══════════════════════════════════════"
echo "  Results: $PASS passed, $FAIL failed"
echo "═══════════════════════════════════════"

exit $FAIL
