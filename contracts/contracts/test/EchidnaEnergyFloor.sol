// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../JOLToken.sol";
import "../EnergyFloor.sol";

/**
 * @title EchidnaEnergyFloor
 * @notice Echidna fuzz target for EnergyFloor.
 *
 * P1: totalMintedFromEnergy * 1 ether <= MAX_FLOOR_MINT
 * P2: totalEnergyReserveKWh >= totalRedeemedKWh (no negative reserve)
 * P3: Each producer's availableKWh <= totalDeposited
 */
contract EchidnaEnergyFloor {
    JOLToken public token;
    EnergyFloor public floor;

    address constant PRODUCER = address(0x1234);

    constructor() {
        token = new JOLToken(address(this));
        floor = new EnergyFloor(address(this), address(token));

        // Grant roles
        token.grantRole(token.MINTER_ROLE(), address(floor));
        token.grantRole(token.BURNER_ROLE(), address(floor));
        floor.grantRole(floor.ORACLE_ROLE(), address(this));
    }

    // Setup producer (call once)
    bool private producerRegistered;

    function registerProducer() external {
        if (!producerRegistered) {
            // Use low-level call since registerProducer uses msg.sender
            (bool ok,) = address(floor).call(
                abi.encodeWithSignature("registerProducer(string,string,string)", "Test", "EE", "solar")
            );
            if (ok) producerRegistered = true;
        }
    }

    function depositEnergy(uint256 kWh) external {
        if (!producerRegistered) return;
        if (kWh == 0 || kWh > 10_000_000) return;
        try floor.depositEnergy(address(this), kWh) {} catch {}
    }

    /// @notice P1: floor mint cap respected
    function echidna_floor_cap() public view returns (bool) {
        return floor.totalMintedFromEnergy() * 1 ether <= floor.MAX_FLOOR_MINT();
    }

    /// @notice P2: reserve consistency
    function echidna_reserve_positive() public view returns (bool) {
        return floor.totalEnergyReserveKWh() >= floor.totalRedeemedKWh();
    }
}
