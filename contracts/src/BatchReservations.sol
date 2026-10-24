// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title BatchReservations
/// @notice Shared allocation registry for declared source batches inside one participating network.
/// @dev Trust model (see docs/TRUST.md):
///  - The registrar (deployer) decides which addresses may declare batches.
///  - A declarant registers a batch's declared mass once and commits a hash of its private evidence.
///  - The declarant grants named reservers an allowance against that batch.
///  - Reservations can never exceed the declared mass or the reserver's allowance.
///  The contract cannot verify physical production, land rights, document accuracy, or allocations
///  recorded outside this contract. Two different batch keys describing the same physical cocoa are
///  indistinguishable here. Quantities are grams (integers); no tokens, value transfer or pricing.
contract BatchReservations {
    struct Batch {
        address declarant;
        uint128 declaredGrams;
        uint128 reservedGrams;
        bytes32 evidenceHash;
        uint64 registeredAt;
    }

    struct Reservation {
        bytes32 batchKey;
        address actor;
        uint128 amountGrams;
        bytes32 evidenceHash;
        uint64 reservedAt;
    }

    address public immutable registrar;

    mapping(address => bool) public isDeclarant;
    mapping(bytes32 => Batch) private _batches;
    mapping(bytes32 => mapping(address => uint256)) public allowanceGrams;
    mapping(bytes32 => Reservation) private _reservations;

    error NotRegistrar();
    error NotDeclarant();
    error NotBatchDeclarant();
    error ZeroKey();
    error ZeroAmount();
    error BatchAlreadyRegistered(bytes32 batchKey);
    error UnknownBatch(bytes32 batchKey);
    error AllocationAlreadyUsed(bytes32 allocationKey);
    error NotAuthorizedReserver(bytes32 batchKey, address actor);
    error ExceedsAllowance(uint256 allowanceGrams, uint256 requestedGrams);
    error ExceedsAvailable(uint256 availableGrams, uint256 requestedGrams);
    error AmountTooLarge();

    event DeclarantSet(address indexed declarant, bool allowed);
    event BatchRegistered(bytes32 indexed batchKey, address indexed declarant, uint256 declaredGrams, bytes32 evidenceHash);
    event ReserverAuthorized(bytes32 indexed batchKey, address indexed actor, uint256 allowanceGrams);
    event Reserved(
        bytes32 indexed batchKey,
        bytes32 indexed allocationKey,
        address indexed actor,
        uint256 amountGrams,
        uint256 reservedGramsAfter,
        bytes32 evidenceHash
    );

    constructor() {
        registrar = msg.sender;
    }

    function setDeclarant(address declarant, bool allowed) external {
        if (msg.sender != registrar) revert NotRegistrar();
        isDeclarant[declarant] = allowed;
        emit DeclarantSet(declarant, allowed);
    }

    function registerBatch(bytes32 batchKey, uint256 declaredGrams, bytes32 evidenceHash) external {
        if (!isDeclarant[msg.sender]) revert NotDeclarant();
        if (batchKey == bytes32(0) || evidenceHash == bytes32(0)) revert ZeroKey();
        if (declaredGrams == 0) revert ZeroAmount();
        if (declaredGrams > type(uint128).max) revert AmountTooLarge();
        if (_batches[batchKey].declarant != address(0)) revert BatchAlreadyRegistered(batchKey);
        _batches[batchKey] = Batch({
            declarant: msg.sender,
            declaredGrams: uint128(declaredGrams),
            reservedGrams: 0,
            evidenceHash: evidenceHash,
            registeredAt: uint64(block.timestamp)
        });
        emit BatchRegistered(batchKey, msg.sender, declaredGrams, evidenceHash);
    }

    /// @notice Sets (not adds to) the remaining grams `actor` may reserve from `batchKey`. Zero revokes.
    function authorizeReserver(bytes32 batchKey, address actor, uint256 allowance) external {
        Batch storage b = _batches[batchKey];
        if (b.declarant == address(0)) revert UnknownBatch(batchKey);
        if (b.declarant != msg.sender) revert NotBatchDeclarant();
        allowanceGrams[batchKey][actor] = allowance;
        emit ReserverAuthorized(batchKey, actor, allowance);
    }

    function reserve(bytes32 batchKey, bytes32 allocationKey, uint256 amountGrams, bytes32 evidenceHash) external {
        if (allocationKey == bytes32(0)) revert ZeroKey();
        if (amountGrams == 0) revert ZeroAmount();
        Batch storage b = _batches[batchKey];
        if (b.declarant == address(0)) revert UnknownBatch(batchKey);
        if (_reservations[allocationKey].actor != address(0)) revert AllocationAlreadyUsed(allocationKey);
        uint256 allowance = allowanceGrams[batchKey][msg.sender];
        if (allowance == 0) revert NotAuthorizedReserver(batchKey, msg.sender);
        if (amountGrams > allowance) revert ExceedsAllowance(allowance, amountGrams);
        uint256 available = uint256(b.declaredGrams) - uint256(b.reservedGrams);
        if (amountGrams > available) revert ExceedsAvailable(available, amountGrams);

        // Checks complete; update ledger, then emit.
        b.reservedGrams += uint128(amountGrams);
        allowanceGrams[batchKey][msg.sender] = allowance - amountGrams;
        _reservations[allocationKey] = Reservation({
            batchKey: batchKey,
            actor: msg.sender,
            amountGrams: uint128(amountGrams),
            evidenceHash: evidenceHash,
            reservedAt: uint64(block.timestamp)
        });
        emit Reserved(batchKey, allocationKey, msg.sender, amountGrams, b.reservedGrams, evidenceHash);
    }

    function getBatch(bytes32 batchKey) external view returns (Batch memory) {
        return _batches[batchKey];
    }

    function getReservation(bytes32 allocationKey) external view returns (Reservation memory) {
        return _reservations[allocationKey];
    }

    function availableGrams(bytes32 batchKey) external view returns (uint256) {
        Batch storage b = _batches[batchKey];
        if (b.declarant == address(0)) revert UnknownBatch(batchKey);
        return uint256(b.declaredGrams) - uint256(b.reservedGrams);
    }
}
