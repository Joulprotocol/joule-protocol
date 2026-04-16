// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../JOLToken.sol";

/**
 * @title HalmosJOLToken
 * @notice Halmos symbolic execution — MATHEMATICAL PROOF of invariants.
 * Unlike fuzz testing (random inputs), Halmos proves that properties
 * hold for ALL POSSIBLE inputs using Z3 SMT solver.
 *
 * Functions prefixed with check_ are Halmos test targets.
 */
contract HalmosJOLToken {
    JOLToken public token;

    constructor() {
        token = new JOLToken(address(this));
        token.grantRole(token.MINTER_ROLE(), address(this));
        token.grantRole(token.BURNER_ROLE(), address(this));
    }

    /// @notice PROVE: mint can never push totalSupply above MAX_SUPPLY
    function check_mint_cap(address to, uint256 amount) external {
        if (to == address(0)) return;
        uint256 max = token.MAX_SUPPLY();
        uint256 supplyBefore = token.totalSupply();

        try token.mint(to, amount) {
            // If mint succeeded, supply must be <= MAX
            assert(token.totalSupply() <= max);
            // And supply increased by exactly amount
            assert(token.totalSupply() == supplyBefore + amount);
        } catch {
            // If mint failed, supply unchanged
            assert(token.totalSupply() == supplyBefore);
        }
    }

    /// @notice PROVE: remainingSupply is always consistent
    function check_remaining_supply(uint256 mintAmount) external {
        if (mintAmount > 0 && token.totalSupply() + mintAmount <= token.MAX_SUPPLY()) {
            token.mint(address(this), mintAmount);
        }
        assert(token.remainingSupply() == token.MAX_SUPPLY() - token.totalSupply());
    }

    /// @notice PROVE: burn reduces supply exactly
    function check_burn_exact(uint256 mintAmt, uint256 burnAmt) external {
        if (mintAmt == 0 || mintAmt > token.MAX_SUPPLY()) return;
        token.mint(address(this), mintAmt);

        if (burnAmt == 0 || burnAmt > token.balanceOf(address(this))) return;
        uint256 supplyBefore = token.totalSupply();

        token.burn(burnAmt);
        assert(token.totalSupply() == supplyBefore - burnAmt);
    }

    /// @notice PROVE: transfer preserves totalSupply
    function check_transfer_preserves_supply(address to, uint256 amount) external {
        if (to == address(0) || amount == 0) return;

        // Mint first so we have tokens
        uint256 toMint = amount < token.MAX_SUPPLY() ? amount : token.MAX_SUPPLY();
        if (token.totalSupply() + toMint > token.MAX_SUPPLY()) return;
        token.mint(address(this), toMint);

        uint256 supplyBefore = token.totalSupply();
        uint256 transferAmt = amount <= token.balanceOf(address(this)) ? amount : token.balanceOf(address(this));
        if (transferAmt == 0) return;

        token.transfer(to, transferAmt);
        assert(token.totalSupply() == supplyBefore);
    }
}
