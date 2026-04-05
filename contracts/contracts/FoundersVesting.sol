// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/finance/VestingWallet.sol";

/**
 * @title JOULEFoundersVesting
 * @notice Founder token vesting — OpenZeppelin, not custom code.
 *
 * "Don't write vesting code yourself. OpenZeppelin is audited. Use it."
 *
 * Parameters:
 *   - Allocation: 12,600,000 JOL (6% of 210M)
 *   - Cliff: 1 year (365 days — nothing released before)
 *   - Linear vesting: 4 years total (1461 days from start)
 *   - Beneficiary: founder wallet (set in constructor)
 *   - Start: mainnet launch timestamp
 *
 * VestingWallet address goes into genesis alloc, NOT founder wallet.
 * This protects everyone — founder included.
 *
 * OZ v4 VestingWallet has no built-in cliff, so this wrapper
 * adds cliff enforcement by overriding _vestingSchedule.
 */
contract JOULEFoundersVesting is VestingWallet {
    uint64 public immutable cliffDuration;

    /**
     * @param beneficiary Founder wallet address
     * @param startTimestamp Mainnet launch timestamp
     * @param cliffSeconds 1 year = 31,536,000 seconds
     * @param durationSeconds 4 years = 126,230,400 seconds
     */
    constructor(
        address beneficiary,
        uint64 startTimestamp,
        uint64 cliffSeconds,
        uint64 durationSeconds
    )
        VestingWallet(beneficiary, startTimestamp, durationSeconds)
    {
        cliffDuration = cliffSeconds;
    }

    /**
     * @notice Override vesting schedule to enforce cliff.
     * Before cliff: 0 vested. After cliff: linear schedule.
     */
    function _vestingSchedule(uint256 totalAllocation, uint64 timestamp)
        internal
        view
        override
        returns (uint256)
    {
        uint64 start_ = uint64(start());
        uint64 cliff = start_ + cliffDuration;

        if (timestamp < cliff) {
            return 0; // Nothing before cliff
        }

        // After cliff: delegate to OZ linear vesting
        return super._vestingSchedule(totalAllocation, timestamp);
    }
}
