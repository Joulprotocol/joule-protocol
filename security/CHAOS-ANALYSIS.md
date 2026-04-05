# JOULE Protocol — Chaos Engineering Analysis

Chain ID: 707070 | Binary: gjoule (go-ethereum fork) | Consensus: Ethash PoW

---

## Overview

This document analyzes JOULE's resilience to failure scenarios. Because JOULE is a geth fork, it inherits geth's battle-tested handling of crashes, partitions, and Byzantine conditions. However, JOULE's small network size (few miners, single bootnode) introduces risks that do not exist on mainnet Ethereum.

---

## Test 1: Kill Node Mid-Block (Crash Recovery)

### What geth does natively
- LevelDB uses a write-ahead log (WAL). Incomplete writes are rolled back on restart.
- On SIGKILL, geth loses only in-flight state that has not been committed to disk.
- On restart, geth replays the WAL and resumes from the last committed block.
- Ancient/freezer database (blocks older than ~90K) uses append-only flat files — safe against partial writes.
- State trie may need partial re-execution from the last committed root.

### JOULE-specific risks
- **Single miner downtime = zero block production.** On mainnet, other miners fill the gap. On JOULE testnet with one or two miners, a crash means the chain halts until restart.
- **Unclean shutdown frequency matters.** Repeated SIGKILLs increase risk of LevelDB corruption. Geth can usually recover, but cumulative damage is possible.
- **No checkpoint protection.** JOULE has no checkpoint oracle or finality gadget. If corruption causes a rollback of many blocks, there is no safety net.

### Recommended monitoring
- Process watchdog that restarts gjoule within 10 seconds of crash (see `joule-watchdog.sh`).
- Alert if gjoule restarts more than 3 times in 1 hour (indicates underlying issue).
- Monitor `gjoule.log` for `"Database compacting"` and `"Rewinding blockchain"` messages post-restart.
- Track block production gap: if no new block for >30 seconds, alert.

---

## Test 2: Network Disconnect (Bootnode Isolation)

### What geth does natively
- Mining continues without peers. Blocks are produced and stored locally.
- Geth periodically attempts to reconnect to bootnodes and previously known peers.
- When peers reconnect, block headers are exchanged and the longest valid chain is adopted.
- Transactions received during isolation stay in the local mempool.

### JOULE-specific risks
- **Single bootnode dependency.** JOULE uses one bootnode at 204.168.211.136. If this node is unreachable (Hetzner outage, IP change, process crash), the local node cannot discover new peers. The `--nodiscover` flag means there is no fallback discovery mechanism.
- **Solo chain divergence.** During isolation, both the local node and the bootnode mine independently. On reconnect, one chain is orphaned. With similar hashrates, the orphan chain could be substantial (many blocks deep).
- **Transaction duplication.** Transactions mined into orphaned blocks return to the mempool and are re-mined on the canonical chain. Users see temporary "confirmations" that revert.

### Recommended monitoring
- Alert if peer count drops to 0 for more than 60 seconds.
- Alert if peer count stays at 0 for more than 5 minutes (likely infrastructure issue, not transient).
- Add a second bootnode on a different provider/region for redundancy.
- Consider removing `--nodiscover` and using a DHT-based discovery for resilience.
- Monitor with: `curl -s -X POST -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"net_peerCount","params":[],"id":1}' http://127.0.0.1:8547`

---

## Test 3: Time Warp (Timestamp Manipulation)

### What geth does natively
- Block timestamps are set by the miner. The EVM's `block.timestamp` reflects this value.
- Consensus rule: `block.timestamp > parent.timestamp` (strictly greater).
- Geth rejects blocks with `timestamp > system_time + 15 seconds` (the `allowedFutureBlockTimeSeconds` constant).
- Difficulty adjustment uses timestamp deltas. Manipulated timestamps affect difficulty.

### JOULE-specific risks
- **Few miners = easy manipulation.** On mainnet, timestamp manipulation is bounded by competition. On JOULE with 1-2 miners, a malicious miner can set timestamps at the edge of the 15s future limit on every block, artificially lowering difficulty over time.
- **Difficulty spiral attack.** A miner who controls >50% hashrate can set timestamps far apart, dropping difficulty, then set them close together, creating blocks faster than intended. This is theoretical but feasible on a small chain.
- **Smart contract risk.** Any JOULE contract using `block.timestamp` for time-sensitive logic (vesting, auctions, timelocks) is vulnerable to manipulation by the mining majority.
- **NTP drift.** If the server's clock drifts, mined blocks may be rejected by peers (if ahead) or suboptimally timed (if behind).

### Recommended monitoring
- Ensure NTP is running: `timedatectl status | grep "synchronized: yes"`.
- Alert if system clock drift exceeds 5 seconds.
- Monitor block time variance: consistent blocks at exactly the minimum timestamp delta suggest manipulation.
- For contracts: avoid `block.timestamp` for precision shorter than ~15 minutes.

---

## Test 4: Mempool Flood

### What geth does natively
- Default mempool (txpool) holds 4096 pending transactions and 1024 queued transactions.
- When full, lowest-gas-price transactions are evicted.
- Transactions are ordered by gas price (highest first) and nonce (sequential per account).
- Rate limiting is per-peer at the P2P layer, not at the RPC layer.
- The `--http.api txpool` endpoint exposes pool status.

### JOULE-specific risks
- **RPC is wide open.** JOULE runs with `--http.addr 0.0.0.0` and `--http.corsdomain "*"`. Any external actor can flood the mempool via RPC. No authentication, no rate limiting.
- **Gas price floor is effectively zero.** On a testnet with no real economic value, there is no gas price competition. An attacker can fill the mempool with 0-gas-price transactions for free.
- **Single miner throughput.** With `--miner.threads 2`, block production rate is limited. A sustained flood can keep the mempool permanently full, causing legitimate transactions to be delayed or dropped.
- **Memory exhaustion.** 4096 pending transactions is manageable, but if queued transactions accumulate (e.g., nonce gaps), memory usage grows.

### Recommended monitoring
- Monitor txpool size: `txpool_status` via RPC. Alert if pending > 1000.
- Rate limit RPC access (nginx reverse proxy, firewall rules, or `--http.vhosts`).
- Consider binding RPC to 127.0.0.1 instead of 0.0.0.0 unless remote access is required.
- Monitor node memory usage. Alert if gjoule exceeds 2GB RSS.
- Set `--txpool.pricelimit` to a non-zero value to require minimum gas price.

---

## Test 5: Duplicate Node (Same Keystore on Two Miners)

### What geth does natively
- Two nodes with the same etherbase produce competing blocks at the same height.
- Geth's consensus selects the first-seen block for propagation; the other becomes a potential uncle.
- Uncle blocks (if referenced within 7 blocks) earn 7/8 of the block reward.
- Unreferenced competing blocks are simply orphaned (no reward).
- Transaction nonce conflicts cause one node's transactions to fail after reorg.

### JOULE-specific risks
- **Amplified uncle rate.** With few miners, two nodes on the same key produce competing blocks at nearly every height. Uncle rate could approach 50%, severely degrading chain quality.
- **Effective hashrate loss.** Two miners on the same key do NOT double the effective security. Competing blocks cancel out, so security hashrate barely increases while electricity cost doubles.
- **Nonce chaos.** If both nodes submit transactions from the same account, nonce conflicts cause unpredictable tx execution. One node sees its transaction confirmed, then it reverts when the other node's block wins.
- **No slashing risk.** Unlike PoS, PoW has no slashing for equivocation. Running duplicate miners is wasteful but not penalized by the protocol.

### Recommended monitoring
- Monitor uncle rate: `eth_getBlockByNumber` — check `uncles` array length.
- Alert if uncle rate exceeds 10% (normal Ethereum mainnet is ~5-7%).
- Ensure each mining node uses a unique keystore.
- If migrating a miner between machines, stop the old one BEFORE starting the new one.

---

## Test 6: Disk Full

### What geth does natively
- LevelDB returns `write: no space left on device` errors.
- Geth cannot commit new state, import blocks, or write logs.
- The node enters a degraded state: it may panic, hang, or crash-loop.
- LevelDB compaction halts, meaning even freeing a small amount of space may not help until a full restart.
- The WAL may have partial writes that require replay on restart.
- Recovery: free space, restart geth. If LevelDB is corrupted, `gjoule removedb` and resync.

### JOULE-specific risks
- **Small disk = fast fill.** Chain data grows at ~1-5 GB/month depending on transaction volume. Log files (`gjoule.log`) grow continuously and are not rotated by default.
- **No graceful degradation.** Geth does not have a "read-only" mode. When disk fills, everything fails at once.
- **Recovery on testnet is painful.** If state is corrupted, resync from genesis or from a snapshot. With no snapshot infrastructure, this means full replay.
- **Log file is the usual culprit.** With `--verbosity 3`, gjoule.log grows fast. It is appended to without rotation.

### Recommended monitoring
- Alert at 80% disk usage, critical at 90%.
- Set up log rotation for `gjoule.log` (logrotate or size-based truncation).
- Monitor chain data size: `du -sh /home/erkki/paul/projects/joule/data/testnet/geth/`.
- Consider `--verbosity 2` in production to reduce log volume.
- Automate: `df -h /home/erkki/paul/projects/joule/data/testnet/ | awk 'NR==2{print $5}'`

---

## Test 7: Network Partition + Rejoin (Chain Reconvergence)

### What geth does natively
- During partition, each side mines its own chain independently.
- On reconnect, nodes exchange block headers starting from the common ancestor.
- The chain with the highest total difficulty is selected as canonical.
- Blocks from the shorter chain are orphaned. Their transactions return to the mempool.
- State is rolled back to the fork point and re-applied along the winning chain.
- This process is called a "reorg" and is a normal part of PoW consensus.

### JOULE-specific risks
- **Deep reorgs.** On mainnet, partitions between major mining pools cause reorgs of 1-2 blocks. On JOULE with 2 miners of similar hashrate, a 60-second partition creates a reorg ~4-5 blocks deep (assuming ~15s block time). This is unusual by Ethereum standards.
- **Confirmation unreliability.** Any transaction confirmed during a partition may be reverted. Applications watching for N confirmations cannot be safe if N < expected_partition_duration / block_time.
- **State rollback cost.** Deep reorgs require re-executing all transactions on the winning chain. With complex contracts, this can take significant time and CPU.
- **Contract state divergence.** If a contract's state differs between the two chains (e.g., different auction winners), the reorg picks one version and discards the other. No merge resolution exists.

### Recommended monitoring
- Monitor for reorgs: watch `gjoule.log` for `"Chain reorg detected"` messages.
- Track reorg depth: alert if any reorg exceeds 3 blocks.
- For applications: require 12+ confirmations for high-value operations.
- Monitor peer count continuously. Zero peers = partition in progress.
- Consider a second bootnode on a different network/datacenter.
- Alert on block time variance: if blocks suddenly come faster after a slow period, a reorg may have occurred.

---

## Summary: JOULE-Specific Risk Profile

| Risk Factor | Mainnet Ethereum | JOULE Testnet | Severity |
|---|---|---|---|
| Crash recovery | Very safe (many nodes) | Safe (geth WAL) but chain halts | Medium |
| Network partition | Rare, shallow reorgs | Likely, deep reorgs | High |
| Timestamp manipulation | Hard (competition) | Easy (few miners) | Medium |
| Mempool flooding | Costly (gas prices) | Free (no economic barrier) | High |
| Duplicate miners | Diluted in large pool | Major uncle rate impact | Low |
| Disk exhaustion | Ops teams handle it | Single operator risk | Medium |
| Bootnode failure | Many bootnodes + DHT | Single point of failure | High |

## Priority Actions

1. **Add a second bootnode** on a different provider. Single bootnode is the highest infrastructure risk.
2. **Restrict RPC access.** Bind to 127.0.0.1 or add nginx with rate limiting. Open RPC is an attack surface.
3. **Set up log rotation** for gjoule.log. Unrotated logs will fill the disk.
4. **Deploy the watchdog** (`joule-watchdog.sh`) as a systemd service for automatic restart.
5. **Monitor peer count, block production rate, and disk usage.** These three metrics catch most failure scenarios early.
6. **Remove `--nodiscover`** or add static peers to reduce partition risk.

---

## Running the Tests

```bash
# All tests (requires sudo for iptables tests)
sudo JOULE_PASSWORD=yourpass ./scripts/chaos-test.sh

# Single test
sudo JOULE_PASSWORD=yourpass ./scripts/chaos-test.sh kill_node
./scripts/chaos-test.sh time_warp      # analysis only, no sudo needed
./scripts/chaos-test.sh disk_full       # analysis only, no sudo needed
./scripts/chaos-test.sh duplicate_node  # analysis only, no sudo needed
```

Tests marked "ANALYSIS ONLY" produce documentation output without making system changes. Destructive tests (kill_node, network_disconnect, network_partition, mempool_flood) modify the running system but include cleanup traps.
