// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {BatchReservations} from "../src/BatchReservations.sol";

/// Engineering tests only. Quantities and keys are test inputs, not commercial inventory.
contract BatchReservationsTest is Test {
    BatchReservations internal reg;
    address internal registrar = address(this);
    address internal declarant = makeAddr("declarant");
    address internal actorA = makeAddr("actorA");
    address internal actorB = makeAddr("actorB");
    address internal outsider = makeAddr("outsider");

    bytes32 internal constant BATCH = keccak256("engineering-test-batch");
    bytes32 internal constant EVIDENCE = keccak256("engineering-test-evidence");
    uint256 internal constant DECLARED = 1_000_000; // 1,000 kg in grams (test value)

    function setUp() public {
        reg = new BatchReservations();
        reg.setDeclarant(declarant, true);
        vm.startPrank(declarant);
        reg.registerBatch(BATCH, DECLARED, EVIDENCE);
        reg.authorizeReserver(BATCH, actorA, DECLARED);
        reg.authorizeReserver(BATCH, actorB, DECLARED);
        vm.stopPrank();
    }

    function _snapshot() internal view returns (BatchReservations.Batch memory) {
        return reg.getBatch(BATCH);
    }

    function test_registrarIsDeployer() public view {
        assertEq(reg.registrar(), registrar);
    }

    function test_onlyRegistrarSetsDeclarant() public {
        vm.prank(outsider);
        vm.expectRevert(BatchReservations.NotRegistrar.selector);
        reg.setDeclarant(outsider, true);
    }

    function test_unauthorizedRegistrationRejected() public {
        vm.prank(outsider);
        vm.expectRevert(BatchReservations.NotDeclarant.selector);
        reg.registerBatch(keccak256("other"), 10, EVIDENCE);
    }

    function test_duplicateRegistrationRejected() public {
        vm.prank(declarant);
        vm.expectRevert(abi.encodeWithSelector(BatchReservations.BatchAlreadyRegistered.selector, BATCH));
        reg.registerBatch(BATCH, 5, EVIDENCE);
        assertEq(_snapshot().declaredGrams, DECLARED);
    }

    function test_zeroDeclaredRejected() public {
        vm.prank(declarant);
        vm.expectRevert(BatchReservations.ZeroAmount.selector);
        reg.registerBatch(keccak256("zero"), 0, EVIDENCE);
    }

    function test_zeroKeysRejected() public {
        vm.startPrank(declarant);
        vm.expectRevert(BatchReservations.ZeroKey.selector);
        reg.registerBatch(bytes32(0), 10, EVIDENCE);
        vm.expectRevert(BatchReservations.ZeroKey.selector);
        reg.registerBatch(keccak256("x"), 10, bytes32(0));
        vm.stopPrank();
    }

    function test_onlyBatchDeclarantAuthorizes() public {
        reg.setDeclarant(outsider, true);
        vm.prank(outsider);
        vm.expectRevert(BatchReservations.NotBatchDeclarant.selector);
        reg.authorizeReserver(BATCH, outsider, 1);
    }

    function test_unauthorizedReservationRejectedStateUnchanged() public {
        vm.prank(outsider);
        vm.expectRevert(abi.encodeWithSelector(BatchReservations.NotAuthorizedReserver.selector, BATCH, outsider));
        reg.reserve(BATCH, keccak256("alloc-x"), 1, EVIDENCE);
        assertEq(_snapshot().reservedGrams, 0);
    }

    function test_zeroReservationRejected() public {
        vm.prank(actorA);
        vm.expectRevert(BatchReservations.ZeroAmount.selector);
        reg.reserve(BATCH, keccak256("alloc-0"), 0, EVIDENCE);
    }

    function test_unknownBatchRejected() public {
        vm.prank(actorA);
        vm.expectRevert(abi.encodeWithSelector(BatchReservations.UnknownBatch.selector, keccak256("nope")));
        reg.reserve(keccak256("nope"), keccak256("alloc"), 1, EVIDENCE);
    }

    /// Case B engineering scenario: A reserves 600 kg, B requests 600 kg, B is rejected by 200 kg.
    function test_twoActorsSharedBalanceExcessRejected() public {
        vm.prank(actorA);
        reg.reserve(BATCH, keccak256("alloc-A"), 600_000, EVIDENCE);
        assertEq(reg.availableGrams(BATCH), 400_000);

        vm.prank(actorB);
        vm.expectRevert(abi.encodeWithSelector(BatchReservations.ExceedsAvailable.selector, 400_000, 600_000));
        reg.reserve(BATCH, keccak256("alloc-B"), 600_000, EVIDENCE);

        BatchReservations.Batch memory b = _snapshot();
        assertEq(b.reservedGrams, 600_000, "reserved total unchanged after rejection");
        assertEq(reg.allowanceGrams(BATCH, actorB), DECLARED, "B allowance unchanged after rejection");
        assertEq(reg.getReservation(keccak256("alloc-B")).actor, address(0), "no reservation recorded for B");

        vm.prank(actorB);
        reg.reserve(BATCH, keccak256("alloc-B2"), 400_000, EVIDENCE);
        assertEq(reg.availableGrams(BATCH), 0);
    }

    function test_duplicateAllocationKeyRejected() public {
        vm.prank(actorA);
        reg.reserve(BATCH, keccak256("alloc-dup"), 100, EVIDENCE);
        vm.prank(actorB);
        vm.expectRevert(abi.encodeWithSelector(BatchReservations.AllocationAlreadyUsed.selector, keccak256("alloc-dup")));
        reg.reserve(BATCH, keccak256("alloc-dup"), 100, EVIDENCE);
        assertEq(_snapshot().reservedGrams, 100);
    }

    function test_retrySameAllocationCannotDoubleReserve() public {
        vm.startPrank(actorA);
        reg.reserve(BATCH, keccak256("alloc-retry"), 250_000, EVIDENCE);
        vm.expectRevert(abi.encodeWithSelector(BatchReservations.AllocationAlreadyUsed.selector, keccak256("alloc-retry")));
        reg.reserve(BATCH, keccak256("alloc-retry"), 250_000, EVIDENCE);
        vm.stopPrank();
        assertEq(_snapshot().reservedGrams, 250_000);
    }

    function test_allowanceCapsActor() public {
        vm.prank(declarant);
        reg.authorizeReserver(BATCH, actorA, 300);
        vm.prank(actorA);
        vm.expectRevert(abi.encodeWithSelector(BatchReservations.ExceedsAllowance.selector, 300, 301));
        reg.reserve(BATCH, keccak256("alloc-cap"), 301, EVIDENCE);
        vm.prank(actorA);
        reg.reserve(BATCH, keccak256("alloc-cap2"), 300, EVIDENCE);
        assertEq(reg.allowanceGrams(BATCH, actorA), 0);
        vm.prank(actorA);
        vm.expectRevert(abi.encodeWithSelector(BatchReservations.NotAuthorizedReserver.selector, BATCH, actorA));
        reg.reserve(BATCH, keccak256("alloc-cap3"), 1, EVIDENCE);
    }

    function test_revokeAllowance() public {
        vm.prank(declarant);
        reg.authorizeReserver(BATCH, actorB, 0);
        vm.prank(actorB);
        vm.expectRevert(abi.encodeWithSelector(BatchReservations.NotAuthorizedReserver.selector, BATCH, actorB));
        reg.reserve(BATCH, keccak256("alloc-rev"), 1, EVIDENCE);
    }

    function test_amountTooLargeRejected() public {
        vm.prank(declarant);
        vm.expectRevert(BatchReservations.AmountTooLarge.selector);
        reg.registerBatch(keccak256("huge"), uint256(type(uint128).max) + 1, EVIDENCE);
    }

    function test_reservedEventEmitted() public {
        vm.expectEmit(true, true, true, true);
        emit BatchReservations.Reserved(BATCH, keccak256("alloc-ev"), actorA, 5, 5, EVIDENCE);
        vm.prank(actorA);
        reg.reserve(BATCH, keccak256("alloc-ev"), 5, EVIDENCE);
    }

    /// Conservation: any sequence of reservation attempts never pushes reserved above declared.
    function testFuzz_conservation(uint256[8] memory amounts) public {
        uint256 accepted;
        for (uint256 i = 0; i < amounts.length; i++) {
            uint256 amt = bound(amounts[i], 1, DECLARED);
            address actor = i % 2 == 0 ? actorA : actorB;
            vm.prank(actor);
            try reg.reserve(BATCH, keccak256(abi.encode("fuzz", i)), amt, EVIDENCE) {
                accepted += amt;
            } catch {}
            BatchReservations.Batch memory b = _snapshot();
            assertLe(b.reservedGrams, b.declaredGrams);
            assertEq(b.reservedGrams, accepted);
        }
    }
}
