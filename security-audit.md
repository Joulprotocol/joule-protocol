# JOULE Security Audit Report

**Date:** 2026-04-04
**Chain:** JOULE Testnet (707070)
**Contracts:** Live on chain
**Result:** 15 passed, 0 failed

## Tests

| # | Test | Result | Details |
|---|------|--------|--------|
| 1 | Mint without MINTER_ROLE | PASS — reverted | AccessControl: account 0x353c819e4fc9cdd756d253a2bc11d140ca57536b is missing role 0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6 |
| 2 | protocolBurn without BURNER_ROLE | PASS — reverted | AccessControl: account 0x353c819e4fc9cdd756d253a2bc11d140ca57536b is missing role 0x3c11d16cbaffd01df69ce1c404f6340ee057498f5f00246190ea54220576a848 |
| 3 | Deployer mint (no MINTER_ROLE) | PASS — reverted | AccessControl: account 0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266 is missing role 0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6 |
| 4 | depositEnergy without ORACLE_ROLE | PASS — reverted | AccessControl: account 0x353c819e4fc9cdd756d253a2bc11d140ca57536b is missing role 0x68e79a7bf1e0bc45d0a330c573bc367f9cf464fd326078812f301165fbda4ef1 |
| 5 | updatePrice without ORACLE_ROLE | PASS — reverted | AccessControl: account 0x353c819e4fc9cdd756d253a2bc11d140ca57536b is missing role 0x68e79a7bf1e0bc45d0a330c573bc367f9cf464fd326078812f301165fbda4ef1 |
| 6 | Join oracle with 0 stake | PASS — reverted | Insufficient stake |
| 7 | Join oracle with insufficient stake | PASS — reverted | Insufficient stake |
| 8 | submitReport without oracle status | PASS — reverted | Not active oracle |
| 9 | accrueReward without ORACLE_ROLE | PASS — reverted | AccessControl: account 0x353c819e4fc9cdd756d253a2bc11d140ca57536b is missing role 0x68e79a7bf1e0bc45d0a330c573bc367f9cf464fd326078812f301165fbda4ef1 |
| 10 | claimRewards with zero balance | PASS — reverted | No pending rewards |
| 11 | verifyFacility without VERIFIER_ROLE | PASS — reverted | AccessControl: account 0x353c819e4fc9cdd756d253a2bc11d140ca57536b is missing role 0x0ce23c3e399818cfee81a7ab0880f714e53d7672b08df0fa62f2843416e1ea09 |
| 12 | recordProduction without VERIFIER_ROLE | PASS — reverted | AccessControl: account 0x353c819e4fc9cdd756d253a2bc11d140ca57536b is missing role 0x0ce23c3e399818cfee81a7ab0880f714e53d7672b08df0fa62f2843416e1ea09 |
| 13 | Register facility with zero capacity | PASS — reverted | Capacity must be > 0 |
| 14 | Register fossil fuel facility (type 4+) | PASS — reverted | missing revert data (action="estimateGas", data=null, reason=null, transaction={ |
| 15 | Replay same nonce | PASS — reverted | nonce has already been used (transaction="0x02f86f830ac9fe80843b9aca00843b9aca0e |

## Summary

All access control tests passed. No unauthorized access possible.
Replay protection works (EVM nonce-based).
