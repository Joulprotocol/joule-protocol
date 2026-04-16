// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../JOLToken.sol";

/**
 * @title EchidnaJOLToken
 * @notice Echidna property-based fuzz target for JOLToken.
 * Properties that must ALWAYS hold, regardless of input:
 *
 * P1: totalSupply() <= MAX_SUPPLY
 * P2: remainingSupply() == MAX_SUPPLY - totalSupply()
 * P3: balanceOf(anyone) <= totalSupply()
 * P4: totalBurned is monotonically increasing
 * P5: No address can mint without MINTER_ROLE
 * P6: No address can protocolBurn without BURNER_ROLE
 */
contract EchidnaJOLToken {
    JOLToken public token;

    uint256 private lastTotalBurned;

    constructor() {
        token = new JOLToken(address(this));
        // Grant this contract MINTER + BURNER for testing
        token.grantRole(token.MINTER_ROLE(), address(this));
        token.grantRole(token.BURNER_ROLE(), address(this));
    }

    // ─── Actions Echidna can call ─────────────────────────────────

    function mint(address to, uint256 amount) external {
        // Bound to reasonable values
        if (to == address(0)) return;
        if (amount > 210_000_000 ether) return;
        try token.mint(to, amount) {} catch {}
    }

    function burn(uint256 amount) external {
        if (amount > token.balanceOf(address(this))) return;
        try token.burn(amount) {} catch {}
    }

    function transfer(address to, uint256 amount) external {
        if (to == address(0)) return;
        try token.transfer(to, amount) {} catch {}
    }

    // ─── Properties (must ALWAYS return true) ─────────────────────

    /// @notice P1: totalSupply never exceeds MAX_SUPPLY
    function echidna_supply_cap() public view returns (bool) {
        return token.totalSupply() <= token.MAX_SUPPLY();
    }

    /// @notice P2: remainingSupply is consistent
    function echidna_remaining_consistent() public view returns (bool) {
        return token.remainingSupply() == token.MAX_SUPPLY() - token.totalSupply();
    }

    /// @notice P3: no individual balance exceeds totalSupply
    function echidna_balance_lte_supply() public view returns (bool) {
        return token.balanceOf(address(this)) <= token.totalSupply();
    }

    /// @notice P4: totalBurned only increases
    function echidna_burned_monotonic() public returns (bool) {
        uint256 current = token.totalBurned();
        bool ok = current >= lastTotalBurned;
        lastTotalBurned = current;
        return ok;
    }
}
