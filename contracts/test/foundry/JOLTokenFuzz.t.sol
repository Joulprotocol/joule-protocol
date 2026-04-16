// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../../contracts/JOLToken.sol";
import "../../contracts/EnergyFloor.sol";
import "../../contracts/EcosystemTreasury.sol";

/**
 * @title JOLTokenFuzz — Foundry 100,000-iteration fuzz tests
 * @notice Property-based testing with Forge's built-in fuzzer.
 * Each test function starting with "testFuzz_" gets 100,000 random inputs.
 */
contract JOLTokenFuzz is Test {
    JOLToken public token;
    address admin = address(this);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    function setUp() public {
        token = new JOLToken(admin);
        token.grantRole(token.MINTER_ROLE(), admin);
        token.grantRole(token.BURNER_ROLE(), admin);
    }

    // ─── INVARIANT: totalSupply <= MAX_SUPPLY ─────────────────────

    function testFuzz_mintNeverExceedsMaxSupply(uint256 amount) public {
        vm.assume(amount > 0);
        uint256 max = token.MAX_SUPPLY();

        if (token.totalSupply() + amount <= max) {
            token.mint(alice, amount);
            assertLe(token.totalSupply(), max, "Supply exceeded MAX");
        } else {
            vm.expectRevert("JOL: exceeds max supply");
            token.mint(alice, amount);
        }
    }

    function testFuzz_mintForNeverExceedsMaxSupply(uint256 amount) public {
        vm.assume(amount > 0);
        uint256 max = token.MAX_SUPPLY();

        if (token.totalSupply() + amount <= max) {
            token.mintFor(alice, amount, "test");
            assertLe(token.totalSupply(), max, "Supply exceeded MAX");
        } else {
            vm.expectRevert("JOL: exceeds max supply");
            token.mintFor(alice, amount, "test");
        }
    }

    // ─── INVARIANT: remainingSupply consistent ────────────────────

    function testFuzz_remainingSupplyConsistent(uint256 amount) public {
        amount = bound(amount, 1, token.MAX_SUPPLY());
        if (token.totalSupply() + amount <= token.MAX_SUPPLY()) {
            token.mint(alice, amount);
        }
        assertEq(
            token.remainingSupply(),
            token.MAX_SUPPLY() - token.totalSupply(),
            "Remaining supply inconsistent"
        );
    }

    // ─── INVARIANT: burn reduces supply correctly ─────────────────

    function testFuzz_burnReducesSupply(uint256 mintAmt, uint256 burnAmt) public {
        mintAmt = bound(mintAmt, 1, token.MAX_SUPPLY());
        token.mint(admin, mintAmt);

        burnAmt = bound(burnAmt, 0, mintAmt);
        uint256 supplyBefore = token.totalSupply();

        if (burnAmt > 0) {
            token.burn(burnAmt);
            assertEq(token.totalSupply(), supplyBefore - burnAmt, "Burn didn't reduce supply");
            assertEq(token.totalBurned(), burnAmt, "totalBurned wrong");
        }
    }

    // ─── INVARIANT: transfer doesn't change supply ────────────────

    function testFuzz_transferPreservesSupply(uint256 amount) public {
        uint256 mintAmt = bound(amount, 1, token.MAX_SUPPLY());
        token.mint(admin, mintAmt);
        uint256 supplyBefore = token.totalSupply();

        uint256 transferAmt = bound(amount, 0, token.balanceOf(admin));
        if (transferAmt > 0 && bob != address(0)) {
            token.transfer(bob, transferAmt);
        }
        assertEq(token.totalSupply(), supplyBefore, "Transfer changed supply");
    }

    // ─── INVARIANT: balances sum to totalSupply ───────────────────

    function testFuzz_balanceSumCorrect(uint256 aliceAmt, uint256 bobAmt) public {
        aliceAmt = bound(aliceAmt, 0, token.MAX_SUPPLY() / 2);
        bobAmt = bound(bobAmt, 0, token.MAX_SUPPLY() / 2);

        if (aliceAmt > 0) token.mint(alice, aliceAmt);
        if (bobAmt > 0) token.mint(bob, bobAmt);

        uint256 sumBalances = token.balanceOf(alice) + token.balanceOf(bob) + token.balanceOf(admin);
        assertEq(sumBalances, token.totalSupply(), "Balance sum != totalSupply");
    }

    // ─── INVARIANT: unauthorized mint always reverts ──────────────

    function testFuzz_unauthorizedMintReverts(address attacker, uint256 amount) public {
        vm.assume(attacker != admin);
        vm.assume(amount > 0);

        vm.prank(attacker);
        vm.expectRevert();
        token.mint(attacker, amount);
    }

    // ─── INVARIANT: unauthorized protocolBurn reverts ─────────────

    function testFuzz_unauthorizedBurnReverts(address attacker, uint256 amount) public {
        vm.assume(attacker != admin);
        vm.assume(amount > 0);

        vm.prank(attacker);
        vm.expectRevert();
        token.protocolBurn(attacker, amount, "hack");
    }

    // ─── INVARIANT: multiple operations maintain MAX_SUPPLY ───────

    function testFuzz_chaosOperations(
        uint256 mint1, uint256 mint2, uint256 burn1, uint256 transfer1
    ) public {
        uint256 max = token.MAX_SUPPLY();

        // Mint rounds
        mint1 = bound(mint1, 0, max / 3);
        if (mint1 > 0) token.mint(alice, mint1);

        mint2 = bound(mint2, 0, max / 3);
        if (token.totalSupply() + mint2 <= max && mint2 > 0) {
            token.mint(bob, mint2);
        }

        // Burn
        burn1 = bound(burn1, 0, token.balanceOf(alice));
        if (burn1 > 0) {
            vm.prank(alice);
            token.burn(burn1);
        }

        // Transfer
        transfer1 = bound(transfer1, 0, token.balanceOf(bob));
        if (transfer1 > 0) {
            vm.prank(bob);
            token.transfer(alice, transfer1);
        }

        // INVARIANT: always holds
        assertLe(token.totalSupply(), max, "MAX_SUPPLY violated after chaos");
        assertEq(
            token.remainingSupply(),
            max - token.totalSupply(),
            "Remaining supply inconsistent after chaos"
        );
    }
}
