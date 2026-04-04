# JOULE Launch Checklist

## Pre-Launch (this week)

### GitHub Repo
- [x] Init git repo
- [ ] .gitignore (node_modules, data/, cache/, keystore/, *.pid, *.log)
- [ ] README.md — "1 JOL = 1 kWh" hook, what it is, how to mine, 30 seconds
- [ ] LICENSE (MIT)
- [ ] Push to github.com (new anonymous account, no personal email)

### Verify before push
- [ ] Zero personal names in code (grep for any identifying info)
- [ ] Zero hardcoded private keys
- [ ] Zero server IPs or internal paths
- [ ] Tests pass: `npx hardhat test` → 38/38

### Mining guide (README section)
```
1. Clone repo
2. Build: cd go-joule && go build -o gjoule ./cmd/geth
3. Init: ./gjoule init genesis.json
4. Mine: ./gjoule --networkid 707070 --mine
5. Add to MetaMask: Chain ID 707070, RPC http://node-ip:8547
```

## Launch Day

### Announce
- [ ] Bitcointalk [ANN] thread (GPU mining section)
- [ ] Telegram group (t.me/jouleprotocol or similar)
- [ ] Reddit: r/gpumining, r/cryptocurrency, r/ethermining

### Seed infrastructure
- [ ] Seed node running with open port (30303)
- [ ] Bootnode enode:// address in README
- [ ] RPC endpoint public (or instructions to run own)

## Week 1-2 After Launch

### Community
- [ ] Discord server
- [ ] First community miners connecting
- [ ] Mining pool (if demand — someone will build it)

### Bounties (from Ecosystem 5% fund — mined first)
- [ ] Block explorer: 50,000 JOL
- [ ] Python SDK: 30,000 JOL
- [ ] Mining pool software: 40,000 JOL
- [ ] Mobile wallet: 30,000 JOL
- [ ] Website joule.energy: 20,000 JOL

## Month 1

### Smart Meter PoC
- [ ] Buy Shelly Pro 3EM (~120 EUR)
- [ ] Install on any electricity source
- [ ] Run meter-bridge.js
- [ ] First verified kWh on-chain
- [ ] Tweet/post: "First real energy on JOULE blockchain"

### Oracle Bootstrap
- [ ] 1st oracle node (seed node operator)
- [ ] 2nd oracle node (community volunteer)
- [ ] 3rd oracle node → 3/5 quorum possible

## Month 2-3

### Growth
- [ ] 5+ oracle nodes
- [ ] 100+ miners
- [ ] First energy producer (contact: Sunly, Enefit Green, or small solar park)
- [ ] DEX listing (community creates Uniswap wJOL/ETH pool)
- [ ] CoinGecko / CoinMarketCap listing application

## Mainnet Decision

Before mainnet, ALL must be true:
- [ ] Testnet stable 30+ days
- [ ] 3+ independent oracle nodes
- [ ] 50+ miners
- [ ] Smart contract audit or bug bounty completed
- [ ] At least 1 energy producer tested PoE flow end-to-end
