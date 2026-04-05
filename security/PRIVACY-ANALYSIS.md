# JOULE Protocol -- Privacy Analysis

**Document type:** On-chain privacy and de-anonymization risk assessment
**Date:** 2026-04-05
**Protocol version:** Whitepaper v1.0, Smart contracts pre-audit
**Scope:** What the JOULE blockchain reveals about participants, who can see it, and how to mitigate exposure

---

## Executive Summary

JOULE's design prioritizes transparency and verifiability -- critical for energy certification and carbon credit integrity. However, this transparency creates significant privacy exposure for participants. The most severe finding is that the EnergyRegistry and MachineRegistry store GPS coordinates (int64 latitude/longitude) directly on-chain, making the physical location of every registered solar panel, wind farm, and IoT device permanently public. Combined with wallet-to-identity linkage through the FoundersVesting contract and KYC requirements at bridge/exchange endpoints, JOULE participants face material de-anonymization risk.

This analysis identifies five primary privacy surfaces and recommends specific mitigations for each.

---

## 1. Founder Wallet -- VestingWallet Identifiability

### What Is Revealed

The `JOULEFoundersVesting` contract is deployed at a known address on-chain. The contract exposes:
- **Beneficiary address:** The founder's wallet is a constructor parameter and is readable via VestingWallet's public `beneficiary()` (inherited from OpenZeppelin). This address is permanently and irrevocably linked to "the JOULE founder."
- **Vesting schedule:** `start()`, `duration()`, and `cliffDuration` are all public. Anyone can calculate exactly when tokens unlock.
- **Release history:** Every `release()` call is a public transaction. Analysts can track exactly how much the founder has claimed and when.
- **Downstream transactions:** Once tokens are released to the beneficiary address, all subsequent transfers, swaps, and interactions are traceable.

### Who Can See It

- **Anyone.** The VestingWallet address will be in the genesis block allocation. Block explorers will label it immediately.
- **Chain analysis firms** (Chainalysis, Elliptic, TRM Labs) will flag the vesting wallet as a "founder" address automatically.
- **Exchanges** will flag deposits from the beneficiary address due to their compliance monitoring.

### Risk Level: HIGH

The founder wallet is the single most identifiable address on the JOULE chain. Even with the "Satoshi model" anonymous team policy, the following de-anonymization vectors exist:

1. **Genesis transaction:** The VestingWallet constructor sets the beneficiary. If the deployer address is linked to any other activity (testnet transactions, ENS names, exchange deposits), the founder is identified.
2. **First miner:** The whitepaper states the founder will be the first miner on testnet. The first mining address is public.
3. **Oracle node:** The founder plans to run an oracle node (10,000 JOL stake). The oracle address earns 2% of PoE rewards, creating an on-chain financial trail.
4. **Energy production:** The Vosges hydro plant (2029 roadmap) will be registered in EnergyRegistry with GPS coordinates. A hydro plant at specific coordinates in the Vosges mountains is trivially identifiable.
5. **Fund flow analysis:** When the founder sells JOL (limited to 1% of daily volume by FounderSellLimit), the destination exchange accounts are subject to KYC.

### Mitigation Recommendations

**Immediate:**
- Use a fresh, dedicated wallet for the VestingWallet beneficiary. Never reuse this address for any other purpose.
- Do not use the same address for mining, oracle staking, and vesting benefits. Maintain strict address separation.
- Route token releases through multiple intermediate wallets before reaching any exchange or identifiable endpoint.

**Medium-term:**
- Implement a privacy-preserving release mechanism: tokens could be released to a stealth address or through a mixing contract (e.g., Tornado Cash-style pool, though regulatory risk applies).
- Consider a multisig beneficiary rather than a single address, introducing plausible deniability about which key holder is "the founder."

**Long-term:**
- Transition vesting to a DAO-controlled mechanism where the community votes on releases. This eliminates the single beneficiary as an identification target.

---

## 2. Energy Producer Locations -- GPS on Public Chain

### What Is Revealed

The `EnergyRegistry.sol` contract stores physical GPS coordinates for every registered energy facility:

```
struct Facility {
    ...
    int64 latitude;    // scaled by 1e6
    int64 longitude;   // scaled by 1e6
    ...
}
```

At 1e6 scaling, these coordinates have approximately 0.1-meter precision. This reveals:
- **Exact physical location** of every solar panel array, wind turbine, hydro installation, and geothermal facility.
- **Facility type** (Solar, Wind, Hydro, Geothermal) -- visible from the `facilityType` enum.
- **Capacity** (`capacityKW`) -- reveals the size of the installation.
- **Production history** -- `totalVerifiedKWh` and `lastReportTimestamp` reveal ongoing production patterns.
- **Owner address** -- links the physical location to a blockchain wallet.

The `MachineRegistry.sol` has the same issue:

```
struct Machine {
    ...
    int64 latitude;
    int64 longitude;
    ...
}
```

Every IoT device, smart meter, EV charger, and AI compute node has its GPS coordinates on-chain.

### Who Can See It

- **Anyone with a block explorer.** Facility data is stored in public mappings. A simple contract read reveals every facility's location.
- **Competitors** can map every energy producer on the network.
- **Governments** can identify unregistered/unreported energy installations.
- **Criminals** can identify high-value targets (a 100 MW solar farm at exact GPS coordinates is a theft/vandalism target).
- **Market analysts** can derive energy production capacity by region.

### Risk Level: CRITICAL

This is the most severe privacy issue in the JOULE protocol. Specific risks:

1. **Physical security:** GPS coordinates of energy facilities are published on an immutable ledger. This cannot be deleted. A solar farm owner's exact address is permanently public.
2. **Regulatory exposure:** In some jurisdictions, energy production requires permits. On-chain registration of an unpermitted facility creates self-incriminating evidence.
3. **Correlation attacks:** GPS coordinates + wallet address + production data = high-confidence identity resolution. Cross-reference with public land registries, building permits, or satellite imagery and the facility owner is identified.
4. **Machine location tracking:** MachineRegistry stores locations for EVs, smart home hubs, and other mobile/personal devices. An EV charger's GPS reveals a home or business address.

### Mitigation Recommendations

**Critical -- implement before mainnet:**

1. **Replace exact GPS with region hashing.** Instead of storing raw coordinates, store:
   - A geohash at reduced precision (e.g., 5-character geohash = ~4.9km x 4.9km cell). Sufficient for PhysicalCap solar calculations but does not reveal exact address.
   - Or: H3 hexagonal index at resolution 4 (~1,770 km2) for physics verification, with exact coordinates submitted encrypted to oracles only.

2. **Move precise coordinates off-chain.** Store only a commitment hash on-chain:
   ```
   bytes32 locationHash = keccak256(abi.encodePacked(latitude, longitude, salt));
   ```
   Oracle nodes verify against the hash during validation. The public chain sees only the hash.

3. **Encrypted oracle submission.** Energy production data and facility details should be encrypted to oracle nodes' public keys. Only the oracle network sees raw data; the chain stores verified aggregates.

4. **Remove GPS from MachineRegistry entirely for mobile devices.** EVs and smart home devices should not have static GPS on a public ledger. Use the device's wallet address as the only identifier.

**Long-term:**
- Implement ZK-SNARK proofs for location verification: "This facility is in EU climate zone X" without revealing the exact address.
- Use Verifiable Delay Functions or commit-reveal schemes for production data.

---

## 3. Transaction Pattern Analysis -- Chain Analysis De-anonymization

### What Is Revealed

JOULE's on-chain activity creates distinctive patterns that chain analysis firms can exploit:

**Mining patterns:**
- PoW mining rewards go to a fixed `etherbase` address. Mining frequency, block times, and hashrate contribution are all public.
- A miner's on-chain pattern (consistent block production at certain times) can correlate with electricity usage patterns or timezone indicators.

**Energy production patterns:**
- PoE rewards are tied to verified energy production. Solar producers earn during daylight hours only. Wind producers earn in weather-correlated patterns. Hydro is more constant.
- A solar producer's reward timing reveals their timezone (and therefore approximate longitude). Combined with the GPS data (Section 2), this is redundant but illustrative of the depth of exposure.
- Production reporting every 15 minutes creates a high-frequency data stream unique to each facility.

**Machine payment patterns:**
- StreamingPayments create continuous micro-transaction streams (per-second billing). These are highly distinctive signatures.
- PaymentChannel off-chain settlements have on-chain open/close transactions that reveal payment relationships.
- AgentWallet has spending limits and patterns that fingerprint the agent's behavior.
- EV charging patterns (if EVs are registered in MachineRegistry) reveal travel routes and charging schedules.

**Governance participation:**
- Every vote is a public transaction linking a wallet to a political position on protocol governance.
- Proposal creation requires 100,000 JOL -- a significant threshold that identifies large holders.

**Bridge usage:**
- BridgeLock stores the user address and amount for every lock/unlock. Cross-chain analysis links JOULE addresses to Ethereum addresses.
- Exchange deposits from Ethereum side are subject to KYC, creating identity linkage.

### Who Can See It

- **Chain analysis firms:** Chainalysis, Elliptic, TRM Labs, and Crystal Blockchain all index EVM-compatible chains.
- **Exchanges:** Compliance teams monitor incoming transactions and flag known mixing patterns.
- **Tax authorities:** Transaction history is sufficient for tax liability calculation.
- **Researchers:** Academic and commercial analysts can map the entire JOULE economy.

### Risk Level: HIGH

JOULE's multi-layered activity (mining + energy + machines + governance + bridge) creates an unusually rich dataset for behavioral analysis. A participant who mines, produces energy, operates machines, votes in governance, and bridges to Ethereum is creating a comprehensive behavioral fingerprint.

### Mitigation Recommendations

**Protocol level:**
1. **Implement confidential transactions** for standard JOL transfers. Consider Pedersen commitments or bulletproofs for hiding transfer amounts while maintaining verifiability.
2. **Add a native mixing pool.** A protocol-level mixer (similar to Zcash's shielded pool) would provide a baseline privacy set. However, this conflicts with regulatory expectations for AML compliance.
3. **Batch PoE rewards.** Instead of individual reward transactions per producer per reporting period, aggregate rewards into periodic batch payouts. This reduces the timing precision available to analysts.
4. **Randomize reporting intervals.** Instead of exactly 15-minute smart meter reporting, allow a randomized window (12-18 minutes) to reduce temporal fingerprinting.

**User level:**
5. **Use separate wallets** for mining, energy production, machine operations, governance, and trading. Never consolidate funds across these roles.
6. **Use the bridge strategically.** Bridge to Ethereum through the privacy set of other bridge users. Avoid bridging unique or identifiable amounts.
7. **Consider CoinJoin-style coordination** for large transfers.

**Infrastructure level:**
8. **Implement Dandelion++ propagation** in the geth fork. This obscures the originating IP of transactions by routing them through random peers before broadcasting.

---

## 4. Oracle IP Addresses -- Network Layer Identification

### What Is Revealed

Oracle nodes are identifiable at two layers:

**On-chain identity:**
- Oracle addresses are registered via ORACLE_ROLE in multiple contracts (EnergyPeg, OracleConsensus).
- Their staking transactions (10,000 JOL minimum) are public.
- Their verification votes (3/5 BFT consensus) are on-chain events.
- Their reward distributions (2% of PoE rewards) are traceable.

**Network layer identity:**
- geth nodes participate in peer-to-peer discovery (devp2p). The node's enode URL contains its public key and IP address.
- Example from README: `enode://70df6358...@204.168.211.136:30307`
- Oracle nodes must be online consistently to participate in verification. Their uptime patterns and IP addresses are visible to any peer.
- Even with Tor or VPN, the oracle must maintain high availability, which limits IP rotation options.
- Network-level monitoring can correlate: IP address submitting oracle votes at the same time as on-chain oracle transactions.

**Combined identification:**
- On-chain oracle address + network IP + staking wallet + reward destination = comprehensive identity profile.
- Cross-reference with ISP records (available to law enforcement), hosting provider registration, or DNS lookups and the oracle operator is fully identified.

### Who Can See It

- **Any peer on the network** can see oracle node IPs through devp2p peer discovery.
- **Hosting providers** know the customer behind the IP.
- **Law enforcement** can subpoena ISP records.
- **Sophisticated attackers** can enumerate all oracle nodes by connecting to the network and mapping peer addresses to on-chain oracle addresses (by observing which peers propagate oracle transactions first).

### Risk Level: HIGH

Oracle operators are critical infrastructure. Their identification creates:
1. **Coercion risk:** A government or attacker who identifies oracle operators can pressure them to submit false verification data.
2. **DDoS targeting:** Known oracle IPs can be targeted to disrupt the verification network.
3. **Legal liability:** Oracle operators who verify energy data may be liable if that data is inaccurate. Identification exposes them to legal action.

### Mitigation Recommendations

1. **Implement a Tor-based oracle submission layer.** Oracle votes should be submitted through Tor hidden services, not through the public p2p network.
2. **Separate oracle voting from node operation.** The oracle's on-chain address should not be the same as its geth node address. Use a relay architecture where votes are submitted through a pool of anonymous relayers.
3. **Threshold signatures for oracle consensus.** Instead of 3/5 individual votes (which identify each oracle), use a threshold signature scheme (e.g., BLS threshold signatures) where the valid signature proves 3/5 agreement without revealing which 3 oracles agreed.
4. **VPN/cloud rotation for oracle infrastructure.** Oracles should run on rotating cloud infrastructure (not personal IPs) with automated failover.
5. **Remove static bootnodes from documentation.** The README publishes a bootnode enode URL with IP. Use DNS-based discovery or a rotating bootnode list instead.

---

## 5. Agent Wallets -- Machine DID to Owner Identity Chain

### What Is Revealed

The `MachineRegistry` contract creates a direct, public, on-chain link between:

```
Machine wallet address
    -> owner address (who registered the machine)
    -> GPS coordinates (where the machine is)
    -> machine type (what it does)
    -> manufacturer + model (what hardware it is)
    -> firmware hash (what software it runs)
    -> reputation score (how it behaves)
    -> transaction count + energy data (what it does on the network)
```

The DID format `did:joule:707070:<wallet_address>` is a permanent identifier that links all of this data.

The `ownerMachines` mapping creates a public list of every machine an address owns. An owner with 50 registered machines has a very distinctive on-chain footprint.

**Identity chain reconstruction:**
1. Machine wallet makes a payment on-chain.
2. `walletToMachine[wallet]` reveals the machine ID.
3. `machines[id]` reveals the owner address, GPS, type, manufacturer, model.
4. `ownerMachines[owner]` reveals all other machines owned by the same entity.
5. Cross-reference owner address with EnergyRegistry (same owner may have energy facilities).
6. Cross-reference with FoundersVesting (is this the founder?).
7. Cross-reference GPS coordinates with public records.

The result: a single machine payment transaction can unravel the complete identity, location, asset portfolio, and behavioral pattern of the machine's owner.

### Who Can See It

- **Anyone.** All of this is in public contract storage.
- **IoT security researchers** will map the entire machine fleet.
- **Competitors** can identify market participants and their infrastructure.
- **Insurers** could use reputation data for risk assessment.
- **Thieves** can identify valuable hardware at known locations.

### Risk Level: HIGH

The combination of owner linkage, GPS coordinates, and device metadata creates a comprehensive surveillance dataset of physical infrastructure. For personal devices (smart home hubs, EVs), this effectively publishes the owner's home address.

### Mitigation Recommendations

**Critical:**
1. **Break the owner-machine link.** Instead of storing the owner address directly, store a commitment:
   ```
   bytes32 ownerHash = keccak256(abi.encodePacked(owner, secret));
   ```
   The owner proves ownership by revealing the preimage, not by having a public mapping.

2. **Remove GPS from machine registration** (see Section 2). For mobile devices, GPS is especially inappropriate. For fixed infrastructure, use regional geohashes instead.

3. **Anonymize manufacturer/model data.** Store device type (enum) on-chain but move manufacturer and model details to encrypted off-chain storage or an IPFS document accessible only to verifiers.

**Medium-term:**
4. **Implement DID resolution through a privacy layer.** The DID `did:joule:707070:<address>` should resolve through a privacy-preserving registry (e.g., using Semaphore or similar ZK identity protocols) rather than a direct on-chain mapping.

5. **Use ephemeral machine wallets.** Machines should rotate wallet addresses periodically (e.g., using HD wallet derivation). Payment channels and streaming payments are off-chain, so rotating the on-chain address does not disrupt ongoing payments.

6. **Implement access-controlled data reads.** Machine metadata (beyond the wallet address and type) should be readable only by authorized parties (verifiers, counterparties), not by the general public. This requires either:
   - Off-chain encrypted storage with on-chain access control.
   - On-chain encryption with key management (complex but possible).

---

## Overall Privacy Risk Matrix

| Data Category | What Is Exposed | Severity | Persistence | Mitigation Complexity |
|--------------|----------------|----------|-------------|----------------------|
| Founder wallet identity | Beneficiary address, vesting schedule, release history | HIGH | Permanent (genesis) | MEDIUM |
| Energy facility GPS | Exact lat/lon of every solar panel, wind farm, hydro plant | CRITICAL | Permanent (immutable) | HIGH |
| Machine GPS + metadata | Device locations, types, owners, firmware, reputation | HIGH | Permanent (immutable) | HIGH |
| Transaction patterns | Mining times, energy production curves, payment streams | HIGH | Cumulative | MEDIUM |
| Oracle network identity | On-chain addresses + network IPs + staking data | HIGH | Ongoing | MEDIUM |
| Governance participation | Voting positions linked to wallet addresses | MEDIUM | Permanent | LOW |
| Bridge cross-chain links | JOULE address linked to Ethereum address | MEDIUM | Permanent | MEDIUM |

## Priority Actions Before Mainnet

1. **CRITICAL: Replace raw GPS coordinates with reduced-precision geohashes** in both EnergyRegistry and MachineRegistry. This is the single most impactful change. Raw sub-meter GPS coordinates on a public immutable ledger is a fundamental design error that cannot be corrected after launch.

2. **HIGH: Implement Dandelion++ transaction propagation** in the geth fork to obscure transaction origin IPs.

3. **HIGH: Design a separation-of-concerns wallet architecture** for users. Document best practices: separate wallets for mining, energy production, machine ownership, governance, and trading. Provide tooling to make this easy.

4. **HIGH: Move machine metadata (manufacturer, model, firmware) off-chain.** Store only the machine type enum and a metadata hash on-chain. Provide off-chain lookup for authorized parties.

5. **MEDIUM: Implement batched PoE reward distribution** to reduce timing-based de-anonymization of energy producers.

6. **MEDIUM: Design ZK-proof location verification** for the PhysicalCap system. Prove "this facility is at latitude X plus/minus Y" without revealing the exact coordinate.

7. **LOW: Publish a Privacy Guide** for JOULE participants documenting best practices for wallet hygiene, address separation, and operational security.

---

## Appendix: Comparison with Other Energy/IoT Blockchains

| Protocol | GPS on-chain | Owner linkage | Machine identity | Privacy layer |
|----------|-------------|---------------|-----------------|---------------|
| JOULE | Raw coordinates | Direct mapping | Full metadata | None |
| Energy Web | No GPS | Indirect | Basic | None |
| Power Ledger | No GPS | Indirect | None | None |
| IoTeX | Optional | Indirect | DID-based | TEE enclaves |
| Helium | H3 hex (reduced) | Indirect | Hotspot metadata | None |

JOULE's current design is the most privacy-exposing of comparable protocols. The Helium model (H3 hexagonal indices instead of raw GPS) is a reasonable compromise that maintains geographic verification without pinpoint accuracy.

---

*This document identifies privacy risks in the JOULE protocol design. It does not constitute legal advice regarding GDPR, ePrivacy Directive, or other data protection regulations. A separate GDPR analysis may be warranted given that GPS coordinates linked to wallet addresses could constitute personal data under Article 4(1) of the GDPR.*
