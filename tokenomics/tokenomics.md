# JOULE Tokenomics — Satoshi Model

## Supply Overview

```
Total Max Supply: 210,000,000 JOL
├── Mining (PoW + PoE):  144,900,000 JOL (69%) — GPU miners & energy producers
├── Energy Reserve:       42,000,000 JOL (20%) — backs 1 JOL = 1 kWh peg
├── Founder:              12,600,000 JOL  (6%) — 1-year cliff, 4-year vesting
└── Ecosystem:            10,500,000 JOL  (5%) — bounties, developers, audits, DEX liquidity
```

## Founder Allocation: 6%

12,600,000 JOL locked in OpenZeppelin VestingWallet.
1-year cliff (nothing released). 4-year linear vesting after cliff.
Founder earns through participation, not extraction.

## Emission Model

| Period | Reward/Block | Total Mined/Year |
|--------|-------------|-----------------|
| Year 1 | 50 JOL | ~105,120,000 |
| Year 2 | 25 JOL | ~52,560,000 |
| Year 3 | 12.5 JOL | ~26,280,000 |
| Year 4 | 6.25 JOL | ~13,140,000 |
| Year 10+ | 0 JOL | Max supply reached |

## Burn Mechanics

All protocol fees are burned (no founder cut):
- 50% of transaction gas fees → burned
- 1.5% of marketplace trades → burned
- 0.1% of streaming payment fees → burned
- Oracle slashing → burned

## Energy Peg

1 JOL = 1 kWh verified renewable energy
Floor price ≈ market price of 1 kWh (~€0.25 in EU)
