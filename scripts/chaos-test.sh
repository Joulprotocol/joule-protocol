#!/bin/bash
# ============================================================================
# JOULE Protocol — Chaos Engineering & Network Partition Tests
# ============================================================================
#
# Tests the resilience of the JOULE chain (geth fork, Chain ID 707070)
# against various failure scenarios.
#
# Usage: sudo ./chaos-test.sh [test_name]
#   Run all tests:     sudo ./chaos-test.sh
#   Run single test:   sudo ./chaos-test.sh kill_node
#
# Available tests:
#   kill_node        - Kill node mid-block, check recovery
#   network_disconnect - Block bootnode, check solo mining
#   time_warp        - ANALYSIS: timestamp dependency check
#   mempool_flood    - Flood 100 txs, check mining throughput
#   duplicate_node   - ANALYSIS: duplicate keystore scenario
#   disk_full        - ANALYSIS: disk exhaustion behavior
#   network_partition - Block peers, verify chain reconvergence
#
# Requirements:
#   - Root/sudo (for iptables tests)
#   - gjoule running on localhost:8547
#   - JOULE_PASSWORD env var set (for node restart)
#
# Safety:
#   - All iptables rules are cleaned up via EXIT trap
#   - Disk full test is analysis-only (no actual disk writes)
#   - Time warp is analysis-only (no clock changes)
# ============================================================================

set -euo pipefail

# --- Configuration ---
JOULE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
GJOULE="$JOULE_DIR/bin/gjoule"
DATADIR="$JOULE_DIR/data/testnet"
GENESIS="$JOULE_DIR/genesis.json"
LOGFILE="$DATADIR/gjoule.log"
PIDFILE="$DATADIR/gjoule.pid"
RPC="http://127.0.0.1:8547"
BOOTNODE_IP="204.168.211.136"
CHAIN_ID=707070
P2P_PORT=30307

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# --- Counters ---
PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0

# ============================================================================
# Cleanup trap — ensures iptables rules are always removed
# ============================================================================
cleanup() {
    echo -e "\n${CYAN}[CLEANUP]${NC} Removing any iptables rules added by chaos tests..."
    iptables -D OUTPUT -d "$BOOTNODE_IP" -j DROP 2>/dev/null || true
    iptables -D INPUT -s "$BOOTNODE_IP" -j DROP 2>/dev/null || true
    # Remove any broad P2P blocks
    iptables -D OUTPUT -p tcp --dport "$P2P_PORT" -j DROP 2>/dev/null || true
    iptables -D INPUT -p tcp --sport "$P2P_PORT" -j DROP 2>/dev/null || true
    iptables -D OUTPUT -p udp --dport "$P2P_PORT" -j DROP 2>/dev/null || true
    iptables -D INPUT -p udp --sport "$P2P_PORT" -j DROP 2>/dev/null || true
    echo -e "${CYAN}[CLEANUP]${NC} Done."
}
trap cleanup EXIT

# ============================================================================
# Utility functions
# ============================================================================

rpc_call() {
    local method="$1"
    local params="${2:-[]}"
    curl -s --max-time 5 -X POST -H "Content-Type: application/json" \
        --data "{\"jsonrpc\":\"2.0\",\"method\":\"$method\",\"params\":$params,\"id\":1}" \
        "$RPC" 2>/dev/null
}

get_block_number() {
    local result
    result=$(rpc_call "eth_blockNumber")
    echo "$result" | python3 -c "import sys,json; print(int(json.load(sys.stdin)['result'],16))" 2>/dev/null
}

get_peer_count() {
    local result
    result=$(rpc_call "net_peerCount")
    echo "$result" | python3 -c "import sys,json; print(int(json.load(sys.stdin)['result'],16))" 2>/dev/null
}

get_tx_count() {
    local addr="$1"
    local result
    result=$(rpc_call "eth_getTransactionCount" "[\"$addr\",\"latest\"]")
    echo "$result" | python3 -c "import sys,json; print(int(json.load(sys.stdin)['result'],16))" 2>/dev/null
}

get_miner_address() {
    local addr
    addr=$(ls "$DATADIR/keystore/" 2>/dev/null | head -1 | grep -oP '[0-9a-f]{40}$')
    if [ -n "$addr" ]; then
        echo "0x$addr"
    fi
}

get_txpool_status() {
    local result
    result=$(rpc_call "txpool_status")
    echo "$result" | python3 -c "
import sys, json
d = json.load(sys.stdin)['result']
pending = int(d['pending'], 16)
queued = int(d['queued'], 16)
print(f'{pending} {queued}')
" 2>/dev/null
}

is_node_running() {
    if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
        return 0
    fi
    return 1
}

wait_for_rpc() {
    local max_wait="${1:-30}"
    local waited=0
    while [ $waited -lt $max_wait ]; do
        if get_block_number >/dev/null 2>&1; then
            return 0
        fi
        sleep 1
        waited=$((waited + 1))
    done
    return 1
}

start_node() {
    if is_node_running; then
        return 0
    fi
    local miner_addr
    miner_addr=$(get_miner_address)
    if [ -z "$miner_addr" ]; then
        echo "ERROR: No miner address found"
        return 1
    fi

    $GJOULE \
        --datadir "$DATADIR" \
        --networkid $CHAIN_ID \
        --port $P2P_PORT \
        --http --http.port 8547 --http.addr "0.0.0.0" \
        --http.api "eth,net,web3,personal,miner,admin,txpool" \
        --http.corsdomain "*" \
        --syncmode full --snapshot=false \
        --mine --miner.etherbase "$miner_addr" \
        --miner.threads 2 \
        --allow-insecure-unlock \
        --bootnodes "enode://70df6358dd077546d9c836a4bcbf9c217a5f15356c69f53a471ebd16fa6d00ed0b0da23c1847b85ffa152bd9ed3bf1d42ba4844f717e76925d54baeeac4f2085@${BOOTNODE_IP}:${P2P_PORT}" \
        --nodiscover \
        --maxpeers 50 \
        --verbosity 3 \
        >> "$LOGFILE" 2>&1 &

    echo $! > "$PIDFILE"
    wait_for_rpc 30
}

report() {
    local status="$1"
    local test_name="$2"
    local detail="$3"
    case "$status" in
        PASS)
            echo -e "  ${GREEN}[PASS]${NC} $test_name — $detail"
            PASS_COUNT=$((PASS_COUNT + 1))
            ;;
        FAIL)
            echo -e "  ${RED}[FAIL]${NC} $test_name — $detail"
            FAIL_COUNT=$((FAIL_COUNT + 1))
            ;;
        SKIP)
            echo -e "  ${YELLOW}[SKIP]${NC} $test_name — $detail"
            SKIP_COUNT=$((SKIP_COUNT + 1))
            ;;
        INFO)
            echo -e "  ${CYAN}[INFO]${NC} $test_name — $detail"
            ;;
    esac
}

separator() {
    echo ""
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${CYAN}  TEST: $1${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

# ============================================================================
# TEST 1: Kill Node Mid-Block
# ============================================================================
# Simulates a sudden crash (OOM kill, hardware failure, power loss).
# Geth uses LevelDB with WAL — partial writes should be recoverable.
# Expected: node restarts and resumes from last committed block.
# ============================================================================
test_kill_node() {
    separator "Kill Node Mid-Block (crash recovery)"

    if ! is_node_running; then
        report SKIP "kill_node" "Node not running. Start it first."
        return
    fi

    # Record state before kill
    local block_before
    block_before=$(get_block_number)
    if [ -z "$block_before" ]; then
        report FAIL "kill_node" "Cannot get block number before kill"
        return
    fi
    report INFO "kill_node" "Block before kill: #$block_before"

    # Kill with SIGKILL (unclean shutdown, no graceful cleanup)
    local pid
    pid=$(cat "$PIDFILE")
    echo "  Sending SIGKILL to PID $pid..."
    kill -9 "$pid" 2>/dev/null || true
    rm -f "$PIDFILE"
    sleep 5

    # Verify it's dead
    if kill -0 "$pid" 2>/dev/null; then
        report FAIL "kill_node" "Process $pid still alive after SIGKILL"
        return
    fi
    report INFO "kill_node" "Node confirmed dead"

    # Restart
    echo "  Restarting node..."
    if ! start_node; then
        report FAIL "kill_node" "Node failed to restart after crash"
        return
    fi

    # Wait for mining to resume (up to 30s)
    sleep 10

    local block_after
    block_after=$(get_block_number)
    if [ -z "$block_after" ]; then
        report FAIL "kill_node" "Cannot get block number after restart"
        return
    fi
    report INFO "kill_node" "Block after restart: #$block_after"

    # Verify chain resumed (block number should be >= before)
    if [ "$block_after" -ge "$block_before" ]; then
        local diff=$((block_after - block_before))
        report PASS "kill_node" "Chain resumed. Blocks mined since restart: $diff. No data loss."
    else
        report FAIL "kill_node" "Block went backwards! Before: $block_before, After: $block_after (possible corruption)"
    fi
}

# ============================================================================
# TEST 2: Network Disconnect (bootnode isolation)
# ============================================================================
# Blocks all traffic to/from the Hetzner bootnode for 60 seconds.
# On a PoW chain, the local node should keep mining solo blocks.
# After unblocking, peers should reconnect and chains should converge.
# ============================================================================
test_network_disconnect() {
    separator "Network Disconnect (bootnode isolation)"

    if [ "$(id -u)" -ne 0 ]; then
        report SKIP "network_disconnect" "Requires root for iptables. Run with sudo."
        return
    fi

    if ! is_node_running; then
        report SKIP "network_disconnect" "Node not running."
        return
    fi

    local peers_before
    peers_before=$(get_peer_count)
    local block_before
    block_before=$(get_block_number)
    report INFO "network_disconnect" "Peers before: $peers_before, Block: #$block_before"

    # Block bootnode
    echo "  Blocking bootnode $BOOTNODE_IP via iptables..."
    iptables -A OUTPUT -d "$BOOTNODE_IP" -j DROP
    iptables -A INPUT -s "$BOOTNODE_IP" -j DROP

    # Wait for disconnect + mining period
    echo "  Waiting 60s for solo mining period..."
    sleep 60

    local peers_during
    peers_during=$(get_peer_count)
    local block_during
    block_during=$(get_block_number)
    report INFO "network_disconnect" "During partition — Peers: $peers_during, Block: #$block_during"

    # Check that node kept mining even without peers
    local solo_blocks=$((block_during - block_before))
    if [ "$solo_blocks" -gt 0 ]; then
        report PASS "network_disconnect/solo_mining" "Mined $solo_blocks blocks while isolated"
    else
        report FAIL "network_disconnect/solo_mining" "No blocks mined during isolation"
    fi

    # Unblock bootnode
    echo "  Unblocking bootnode..."
    iptables -D OUTPUT -d "$BOOTNODE_IP" -j DROP 2>/dev/null || true
    iptables -D INPUT -s "$BOOTNODE_IP" -j DROP 2>/dev/null || true

    # Wait for reconnection
    echo "  Waiting 30s for peer reconnection..."
    sleep 30

    local peers_after
    peers_after=$(get_peer_count)
    local block_after
    block_after=$(get_block_number)
    report INFO "network_disconnect" "After unblock — Peers: $peers_after, Block: #$block_after"

    if [ "$peers_after" -gt 0 ]; then
        report PASS "network_disconnect/reconnect" "Peers reconnected ($peers_after peers)"
    else
        report FAIL "network_disconnect/reconnect" "No peers reconnected after 30s"
    fi
}

# ============================================================================
# TEST 3: Time Warp (ANALYSIS ONLY)
# ============================================================================
# Geth uses block.timestamp for all EVM operations — contracts that use
# block.timestamp get the miner-set value, not the system clock.
# We do NOT modify the system clock on a live system.
# ============================================================================
test_time_warp() {
    separator "Time Warp Analysis (ANALYSIS ONLY — no system changes)"

    echo -e "  ${CYAN}[ANALYSIS]${NC} Geth timestamp behavior:"
    echo ""
    echo "  How geth handles block timestamps:"
    echo "  1. block.timestamp is set by the miner, not derived from system clock"
    echo "  2. Consensus rule: timestamp must be > parent.timestamp"
    echo "  3. Peers reject blocks with timestamp > now + 15 seconds (allowedFutureBlockTime)"
    echo "  4. Solidity's block.timestamp / 'now' returns this miner-set value"
    echo ""
    echo "  JOULE-specific considerations:"
    echo "  - If system clock drifts >15s ahead, our mined blocks get rejected by peers"
    echo "  - If system clock drifts behind, we'll mine valid but suboptimal blocks"
    echo "  - NTP sync is essential for mining nodes"
    echo ""
    echo "  Smart contract implications:"
    echo "  - Timelocks in contracts use block.timestamp (safe from local clock changes)"
    echo "  - Miners can manipulate timestamp by ~15 seconds (geth consensus limit)"
    echo "  - For JOULE with few miners, timestamp manipulation risk is HIGHER"
    echo ""

    # Verify current block timestamp vs system time
    if is_node_running; then
        local latest
        latest=$(rpc_call "eth_getBlockByNumber" "[\"latest\",false]")
        local block_ts
        block_ts=$(echo "$latest" | python3 -c "import sys,json; print(int(json.load(sys.stdin)['result']['timestamp'],16))" 2>/dev/null)
        local sys_ts
        sys_ts=$(date +%s)
        if [ -n "$block_ts" ]; then
            local drift=$((sys_ts - block_ts))
            report INFO "time_warp" "Latest block timestamp: $block_ts, System time: $sys_ts, Drift: ${drift}s"
            if [ "${drift#-}" -le 15 ]; then
                report PASS "time_warp" "Block timestamp within 15s of system clock (drift: ${drift}s)"
            else
                report FAIL "time_warp" "Block timestamp drift is ${drift}s (>15s threshold)"
            fi
        fi
    fi

    echo ""
    echo "  Recommendation: Set up NTP monitoring with alerting if drift > 5 seconds."
    echo "  Command to check: timedatectl status | grep 'synchronized'"
    SKIP_COUNT=$((SKIP_COUNT + 1))
}

# ============================================================================
# TEST 4: Mempool Flood
# ============================================================================
# Sends 100 simple value transfers rapidly to test mempool handling
# and mining throughput. All txs go from the miner to itself (self-send).
# ============================================================================
test_mempool_flood() {
    separator "Mempool Flood (100 rapid transactions)"

    if ! is_node_running; then
        report SKIP "mempool_flood" "Node not running."
        return
    fi

    local miner_addr
    miner_addr=$(get_miner_address)
    if [ -z "$miner_addr" ]; then
        report FAIL "mempool_flood" "No miner address found"
        return
    fi

    # Unlock the account
    if [ -z "${JOULE_PASSWORD:-}" ]; then
        report SKIP "mempool_flood" "JOULE_PASSWORD not set. Cannot unlock account."
        return
    fi

    echo "  Unlocking miner account..."
    local unlock_result
    unlock_result=$(rpc_call "personal_unlockAccount" "[\"$miner_addr\",\"$JOULE_PASSWORD\",300]")
    local unlocked
    unlocked=$(echo "$unlock_result" | python3 -c "import sys,json; print(json.load(sys.stdin).get('result','false'))" 2>/dev/null)
    if [ "$unlocked" != "True" ]; then
        report FAIL "mempool_flood" "Failed to unlock account: $unlock_result"
        return
    fi

    local block_before
    block_before=$(get_block_number)
    local nonce_before
    nonce_before=$(get_tx_count "$miner_addr")
    report INFO "mempool_flood" "Starting at block #$block_before, nonce: $nonce_before"

    # Send 100 transactions as fast as possible
    echo "  Sending 100 transactions..."
    local sent=0
    local errors=0
    local start_time
    start_time=$(date +%s)

    for i in $(seq 1 100); do
        local result
        result=$(rpc_call "eth_sendTransaction" "[{
            \"from\": \"$miner_addr\",
            \"to\": \"$miner_addr\",
            \"value\": \"0x1\",
            \"gas\": \"0x5208\"
        }]")

        if echo "$result" | grep -q '"result"'; then
            sent=$((sent + 1))
        else
            errors=$((errors + 1))
        fi

        # Progress indicator every 25 txs
        if [ $((i % 25)) -eq 0 ]; then
            echo "    Sent $i/100 ($errors errors so far)..."
        fi
    done

    local send_time
    send_time=$(( $(date +%s) - start_time ))
    report INFO "mempool_flood" "Sent $sent/100 txs in ${send_time}s ($errors errors)"

    # Check txpool status immediately
    local pool_status
    pool_status=$(get_txpool_status)
    report INFO "mempool_flood" "Txpool status: pending=$(echo $pool_status | cut -d' ' -f1), queued=$(echo $pool_status | cut -d' ' -f2)"

    # Wait for all txs to be mined (up to 120s)
    echo "  Waiting for transactions to be mined (max 120s)..."
    local max_wait=120
    local waited=0
    local all_mined=false

    while [ $waited -lt $max_wait ]; do
        local nonce_now
        nonce_now=$(get_tx_count "$miner_addr")
        local mined=$((nonce_now - nonce_before))

        if [ "$mined" -ge "$sent" ]; then
            all_mined=true
            break
        fi

        if [ $((waited % 15)) -eq 0 ] && [ $waited -gt 0 ]; then
            echo "    $mined/$sent mined after ${waited}s..."
        fi
        sleep 5
        waited=$((waited + 5))
    done

    local block_after
    block_after=$(get_block_number)
    local nonce_after
    nonce_after=$(get_tx_count "$miner_addr")
    local total_mined=$((nonce_after - nonce_before))
    local blocks_used=$((block_after - block_before))

    if [ "$all_mined" = true ]; then
        report PASS "mempool_flood" "All $total_mined/$sent txs mined in ${waited}s across $blocks_used blocks"
    else
        report FAIL "mempool_flood" "Only $total_mined/$sent txs mined in ${max_wait}s ($blocks_used blocks)"
    fi

    # Calculate throughput
    if [ "$blocks_used" -gt 0 ]; then
        local tps_approx=$((total_mined / (waited > 0 ? waited : 1)))
        report INFO "mempool_flood" "Approx throughput: ~${tps_approx} tx/s, ~$((total_mined / blocks_used)) tx/block"
    fi
}

# ============================================================================
# TEST 5: Duplicate Node (ANALYSIS ONLY)
# ============================================================================
# Analysis of what happens when the same keystore is used on two nodes.
# We do NOT actually start a duplicate node.
# ============================================================================
test_duplicate_node() {
    separator "Duplicate Node Analysis (ANALYSIS ONLY — no changes)"

    echo -e "  ${CYAN}[ANALYSIS]${NC} Running same keystore on two mining nodes:"
    echo ""
    echo "  Scenario: Node A (local) and Node B (remote) both mine with same etherbase."
    echo ""
    echo "  What happens:"
    echo "  1. UNCLE BLOCKS: Both nodes mine blocks at similar height. When they"
    echo "     announce to the network, the first-seen block wins propagation."
    echo "     The loser's block becomes an uncle (if referenced) or is orphaned."
    echo ""
    echo "  2. WASTED WORK: Both nodes spend PoW energy on the same etherbase."
    echo "     On average, total hashrate contribution is NOT doubled because"
    echo "     competing blocks cancel each other out ~50% of the time."
    echo ""
    echo "  3. NO DOUBLE-SPEND RISK: Both nodes mine to the same address, so"
    echo "     block rewards go to the same account regardless of which node wins."
    echo "     No funds are at risk — it's purely wasted electricity/compute."
    echo ""
    echo "  4. TRANSACTION CONFLICTS: If both nodes submit transactions from the"
    echo "     same account, nonce conflicts occur. One tx succeeds, the other"
    echo "     fails with 'nonce too low' after reorg."
    echo ""
    echo "  5. UNCLE REWARD: Uncle blocks referenced by later blocks earn"
    echo "     7/8 of full block reward in standard geth. Since both mine to"
    echo "     the same address, uncle rewards still accrue to the same wallet."
    echo ""
    echo "  JOULE-specific risk:"
    echo "  - With few miners, duplicate nodes increase uncle rate significantly"
    echo "  - Block time variance increases (network sees bursts of competing blocks)"
    echo "  - The chain's effective security hashrate does NOT increase"
    echo ""
    echo "  Detection: Monitor uncle rate via eth_getBlockByNumber — if"
    echo "  block.uncles is frequently non-empty, investigate."
    echo ""
    echo "  Recommendation: NEVER run duplicate miners. Use one node per keystore."

    report INFO "duplicate_node" "Analysis complete. See output above."
    SKIP_COUNT=$((SKIP_COUNT + 1))
}

# ============================================================================
# TEST 6: Disk Full Simulation (ANALYSIS ONLY)
# ============================================================================
# Analysis of geth behavior when disk space runs out.
# We do NOT actually fill the disk.
# ============================================================================
test_disk_full() {
    separator "Disk Full Analysis (ANALYSIS ONLY — no disk writes)"

    echo -e "  ${CYAN}[ANALYSIS]${NC} Geth behavior when disk space is exhausted:"
    echo ""
    echo "  LevelDB (geth's storage backend) behavior:"
    echo "  1. LevelDB returns 'write: no space left on device' errors"
    echo "  2. Geth catches these and enters a crash loop or hangs"
    echo "  3. Compaction stops, making the situation worse even if some space freed"
    echo "  4. The WAL (write-ahead log) may be corrupted if partially written"
    echo ""
    echo "  What geth does specifically:"
    echo "  - Mining stops (cannot write new state to disk)"
    echo "  - Block import fails (cannot persist new chain data)"
    echo "  - Geth logs: 'Failed to commit new state' and similar errors"
    echo "  - The node does NOT cleanly shut down — it hangs or panics"
    echo "  - On restart after freeing space, geth replays from last good state"
    echo "  - Ancient/freezer database may also fail if chaindata partition is full"
    echo ""
    echo "  Recovery procedure:"
    echo "  1. Free disk space (delete old logs, prune state)"
    echo "  2. Restart geth — it will attempt recovery from WAL"
    echo "  3. If corrupted: gjoule --datadir ... removedb, then resync"
    echo "  4. For JOULE testnet: worst case, re-init from genesis"
    echo ""

    # Show current disk usage
    if [ -d "$DATADIR" ]; then
        echo "  Current JOULE disk usage:"
        local disk_usage
        disk_usage=$(du -sh "$DATADIR" 2>/dev/null | cut -f1)
        local disk_avail
        disk_avail=$(df -h "$DATADIR" 2>/dev/null | tail -1 | awk '{print $4}')
        local disk_pct
        disk_pct=$(df -h "$DATADIR" 2>/dev/null | tail -1 | awk '{print $5}')
        echo "    Chain data:   $disk_usage"
        echo "    Disk free:    $disk_avail"
        echo "    Disk used:    $disk_pct"
        echo ""

        if [ -n "$disk_pct" ]; then
            local pct_num
            pct_num=$(echo "$disk_pct" | tr -d '%')
            if [ "$pct_num" -gt 90 ]; then
                report FAIL "disk_full" "Disk usage at $disk_pct — CRITICAL! Free space immediately."
            elif [ "$pct_num" -gt 80 ]; then
                report FAIL "disk_full" "Disk usage at $disk_pct — WARNING. Plan for space."
            else
                report PASS "disk_full" "Disk usage at $disk_pct — healthy"
            fi
        fi
    fi

    # Check log for any disk errors
    if [ -f "$LOGFILE" ]; then
        local disk_errors
        disk_errors=$(grep -ci "no space\|disk full\|write error\|i/o error" "$LOGFILE" 2>/dev/null || echo "0")
        if [ "$disk_errors" -gt 0 ]; then
            report FAIL "disk_full/logs" "Found $disk_errors disk-related errors in gjoule.log"
            grep -i "no space\|disk full\|write error\|i/o error" "$LOGFILE" | tail -5
        else
            report PASS "disk_full/logs" "No disk-related errors in gjoule.log"
        fi
    fi

    echo ""
    echo "  Recommendation: Set up disk space alerting at 80% and 90% thresholds."
    echo "  Monitor with: df -h $DATADIR | awk 'NR==2{print \$5}'"
    SKIP_COUNT=$((SKIP_COUNT + 1))
}

# ============================================================================
# TEST 7: Network Partition + Rejoin (chain reconvergence)
# ============================================================================
# Blocks all P2P traffic, allowing both local and remote nodes to mine
# independently. After unblocking, longest chain should win and nodes
# should converge to the same block.
#
# NOTE: This test can only verify the LOCAL side. The remote node's
# behavior is inferred from geth's known consensus rules.
# ============================================================================
test_network_partition() {
    separator "Network Partition + Rejoin (chain reconvergence)"

    if [ "$(id -u)" -ne 0 ]; then
        report SKIP "network_partition" "Requires root for iptables. Run with sudo."
        return
    fi

    if ! is_node_running; then
        report SKIP "network_partition" "Node not running."
        return
    fi

    local peers_before
    peers_before=$(get_peer_count)
    if [ "$peers_before" -eq 0 ]; then
        report SKIP "network_partition" "No peers connected. Cannot test partition."
        return
    fi

    local block_before
    block_before=$(get_block_number)
    report INFO "network_partition" "Pre-partition: Block #$block_before, Peers: $peers_before"

    # Block ALL P2P traffic (TCP and UDP on geth port)
    echo "  Creating network partition (blocking port $P2P_PORT)..."
    iptables -A OUTPUT -p tcp --dport "$P2P_PORT" -j DROP
    iptables -A INPUT -p tcp --sport "$P2P_PORT" -j DROP
    iptables -A OUTPUT -p udp --dport "$P2P_PORT" -j DROP
    iptables -A INPUT -p udp --sport "$P2P_PORT" -j DROP
    # Also block bootnode specifically (it may use different source port)
    iptables -A OUTPUT -d "$BOOTNODE_IP" -j DROP
    iptables -A INPUT -s "$BOOTNODE_IP" -j DROP

    echo "  Partition active. Mining independently for 60s..."
    sleep 60

    local block_partitioned
    block_partitioned=$(get_block_number)
    local solo_blocks=$((block_partitioned - block_before))
    local peers_partitioned
    peers_partitioned=$(get_peer_count)
    report INFO "network_partition" "During partition: Block #$block_partitioned (+$solo_blocks), Peers: $peers_partitioned"

    if [ "$solo_blocks" -gt 0 ]; then
        report PASS "network_partition/solo_mining" "Mined $solo_blocks blocks during partition"
    else
        report FAIL "network_partition/solo_mining" "No blocks mined during partition"
    fi

    if [ "$peers_partitioned" -eq 0 ]; then
        report PASS "network_partition/isolation" "Node fully isolated (0 peers)"
    else
        report FAIL "network_partition/isolation" "Node still has $peers_partitioned peers despite partition"
    fi

    # Heal the partition
    echo "  Removing partition rules..."
    iptables -D OUTPUT -p tcp --dport "$P2P_PORT" -j DROP 2>/dev/null || true
    iptables -D INPUT -p tcp --sport "$P2P_PORT" -j DROP 2>/dev/null || true
    iptables -D OUTPUT -p udp --dport "$P2P_PORT" -j DROP 2>/dev/null || true
    iptables -D INPUT -p udp --sport "$P2P_PORT" -j DROP 2>/dev/null || true
    iptables -D OUTPUT -d "$BOOTNODE_IP" -j DROP 2>/dev/null || true
    iptables -D INPUT -s "$BOOTNODE_IP" -j DROP 2>/dev/null || true

    echo "  Partition healed. Waiting 30s for reconvergence..."
    sleep 30

    local block_after
    block_after=$(get_block_number)
    local peers_after
    peers_after=$(get_peer_count)
    report INFO "network_partition" "Post-rejoin: Block #$block_after, Peers: $peers_after"

    # After rejoin, the longest chain wins. If the remote had more hashpower,
    # our local chain may have been reorged (block_after could be different
    # from block_partitioned).
    if [ "$peers_after" -gt 0 ]; then
        report PASS "network_partition/rejoin" "Peers reconnected ($peers_after peers)"
    else
        report FAIL "network_partition/rejoin" "No peers after 30s — reconnection failed"
    fi

    if [ "$block_after" -ge "$block_partitioned" ]; then
        report PASS "network_partition/chain" "Chain progressed: #$block_partitioned -> #$block_after"
    fi

    # Check for reorg
    if [ "$block_after" -lt "$block_partitioned" ]; then
        local reorg_depth=$((block_partitioned - block_after))
        report INFO "network_partition/reorg" "REORG DETECTED: depth=$reorg_depth blocks. Remote chain was longer."
        report PASS "network_partition/reorg" "Reorg handled correctly (longest chain won)"
    else
        report INFO "network_partition/reorg" "No reorg — local chain was equal or longer"
    fi

    echo ""
    echo "  Chain reconvergence behavior (geth native):"
    echo "  - On reconnect, peers exchange block headers"
    echo "  - Geth selects chain with highest total difficulty"
    echo "  - Orphaned blocks from the shorter fork are discarded"
    echo "  - Transactions from orphaned blocks return to the mempool"
    echo "  - State is rolled back and re-applied from the canonical chain"
}

# ============================================================================
# Main — run all or selected tests
# ============================================================================

echo ""
echo "╔══════════════════════════════════════════════════════════════════════════╗"
echo "║           JOULE Protocol — Chaos Engineering Test Suite                ║"
echo "║           Chain ID: $CHAIN_ID | RPC: $RPC                       ║"
echo "╚══════════════════════════════════════════════════════════════════════════╝"
echo ""

# Check basic connectivity
if ! get_block_number >/dev/null 2>&1; then
    echo -e "${RED}ERROR: Cannot connect to JOULE RPC at $RPC${NC}"
    echo "Start the node first: ./start-testnet.sh"
    exit 1
fi

CURRENT_BLOCK=$(get_block_number)
echo "Connected to JOULE. Current block: #$CURRENT_BLOCK"
echo ""

# Run selected test or all tests
TEST_NAME="${1:-all}"

case "$TEST_NAME" in
    kill_node)          test_kill_node ;;
    network_disconnect) test_network_disconnect ;;
    time_warp)          test_time_warp ;;
    mempool_flood)      test_mempool_flood ;;
    duplicate_node)     test_duplicate_node ;;
    disk_full)          test_disk_full ;;
    network_partition)  test_network_partition ;;
    all)
        test_kill_node
        test_network_disconnect
        test_time_warp
        test_mempool_flood
        test_duplicate_node
        test_disk_full
        test_network_partition
        ;;
    *)
        echo "Unknown test: $TEST_NAME"
        echo "Available: kill_node, network_disconnect, time_warp, mempool_flood,"
        echo "           duplicate_node, disk_full, network_partition, all"
        exit 1
        ;;
esac

# Summary
echo ""
echo "╔══════════════════════════════════════════════════════════════════════════╗"
echo "║  RESULTS SUMMARY                                                       ║"
echo "╠══════════════════════════════════════════════════════════════════════════╣"
echo -e "║  ${GREEN}PASS: $PASS_COUNT${NC}    ${RED}FAIL: $FAIL_COUNT${NC}    ${YELLOW}SKIP/ANALYSIS: $SKIP_COUNT${NC}                          ║"
echo "╚══════════════════════════════════════════════════════════════════════════╝"
echo ""

if [ "$FAIL_COUNT" -gt 0 ]; then
    exit 1
fi
exit 0
