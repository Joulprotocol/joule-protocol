# JOULE Tokenomics — Satoshi Model

## Supply Overview

```
Total Max Supply: 210,000,000 JOL
├── Mining (PoW + PoE):  147,000,000 JOL (70%) — GPU miners & energy producers
├── Energy Reserve:       39,900,000 JOL (19%) — backs 1 JOL = 1 kWh peg
├── Founder:              12,600,000 JOL  (6%) — 1-year cliff, 4-year vesting
└── Ecosystem:            10,500,000 JOL  (5%)
    ├── 90% Development:   9,450,000 JOL — bounties, developers, audits, DEX liquidity
    └── 10% Insurance:     1,050,000 JOL — smart contract bug coverage (DAO + 7d timelock)
```

## Founder Allocation: 6%

12,600,000 JOL locked in OpenZeppelin VestingWallet.
1-year cliff (nothing released). 4-year linear vesting after cliff.
Founder earns through participation, not extraction.

## Emission Model

| Period | Reward/Block | Total Mined/Year |
|--------|-------------|-----------------|
| Era 0 (Year 1) | 36 JOL | 75,600,000 |
| Era 1 (Year 2) | 18 JOL | 37,800,000 |
| Era 2 (Year 3) | 9 JOL | 18,900,000 |
| Era 3 (Year 4) | 4 JOL | 8,400,000 |
| Era 4 (Year 5) | 2 JOL | 4,200,000 |
| Era 5 (Year 6) | 1 JOL | 2,100,000 |
| Era 6+ | 0 JOL | Mining complete (147M) |

## Burn Mechanics

All protocol fees are burned (no founder cut):
- 50% of transaction gas fees → burned
- 1.5% of marketplace trades → burned
- 0.1% of streaming payment fees → burned
- Oracle slashing → burned

## Energy Floor

1 JOL = 1 kWh verified renewable energy
Floor price ≈ market price of 1 kWh (~€0.25 in EU)
