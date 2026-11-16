// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title StudentAttendance
/// @notice Instructor-authorized, wallet-based attendance for time-bounded sessions.
/// @dev QR authorizations use EIP-712 and are bound to this contract and the current chain.
contract StudentAttendance {
    // secp256k1n / 2; enforcing low-s prevents signature malleability.
    uint256 private constant SECP256K1_HALF_ORDER =
        0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    bytes32 private constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 private constant NAME_HASH = keccak256("StudentAttendance");
    bytes32 private constant VERSION_HASH = keccak256("1");
    bytes32 private constant ATTENDANCE_TYPEHASH =
        keccak256("AttendanceAuthorization(uint256 sessionId,uint256 qrNonce,uint256 expiresAt)");

    address public admin;
    address public pendingAdmin;
    uint256 public nextSessionId = 1;

    mapping(address => bool) public instructors;
    mapping(address => bool) public registeredStudents;

    struct Session {
        address instructor;
        uint64 startsAt;
        uint64 endsAt;
        uint64 qrNonce;
        bool active;
    }

    mapping(uint256 => Session) public sessions;
    mapping(uint256 => mapping(address => uint64)) public attendanceAt;

    error ZeroAddress();
    error Unauthorized();
    error AlreadyAuthorized();
    error NotAuthorized();
    error InvalidSession();
    error InvalidTimeRange();
    error SessionNotActive();
    error StudentNotRegistered();
    error AlreadyAttended();
    error AuthorizationExpired();
    error InvalidQrNonce();
    error InvalidSignature();
    error NoPendingAdmin();
    error InvalidAdminProposal();

    event InstructorUpdated(address indexed instructor, bool authorized);
    event AdminTransferProposed(address indexed currentAdmin, address indexed proposedAdmin);
    event AdminTransferred(address indexed previousAdmin, address indexed newAdmin);
    event StudentUpdated(address indexed student, bool registered, address indexed updatedBy);
    event SessionCreated(
        uint256 indexed sessionId,
        address indexed instructor,
        uint64 startsAt,
        uint64 endsAt,
        uint64 qrNonce
    );
    event SessionStatusUpdated(uint256 indexed sessionId, bool active);
    event QrNonceRotated(uint256 indexed sessionId, uint64 newNonce);
    event AttendanceRecorded(
        uint256 indexed sessionId,
        address indexed student,
        address indexed instructor,
        uint64 recordedAt
    );

    modifier onlyAdmin() {
        if (msg.sender != admin) revert Unauthorized();
        _;
    }

    modifier onlyInstructor() {
        if (!instructors[msg.sender]) revert Unauthorized();
        _;
    }

    constructor() {
        admin = msg.sender;
        instructors[msg.sender] = true;
        emit InstructorUpdated(msg.sender, true);
    }

    /// @notice Propose a two-step administrator transfer.
    function proposeAdmin(address proposedAdmin) external onlyAdmin {
        if (proposedAdmin == address(0)) revert ZeroAddress();
        if (proposedAdmin == admin || proposedAdmin == address(this)) {
            revert InvalidAdminProposal();
        }
        pendingAdmin = proposedAdmin;
        emit AdminTransferProposed(admin, proposedAdmin);
    }

    /// @notice Accept administrator privileges as the pending administrator.
    function acceptAdmin() external {
        if (msg.sender != pendingAdmin || pendingAdmin == address(0)) revert NoPendingAdmin();
        address previousAdmin = admin;
        admin = msg.sender;
        pendingAdmin = address(0);
        if (!instructors[msg.sender]) {
            instructors[msg.sender] = true;
            emit InstructorUpdated(msg.sender, true);
        }
        emit AdminTransferred(previousAdmin, msg.sender);
    }

    /// @notice Grant instructor privileges. Only the current admin may do this.
    function authorizeInstructor(address instructor) external onlyAdmin {
        if (instructor == address(0)) revert ZeroAddress();
        if (instructors[instructor]) revert AlreadyAuthorized();
        instructors[instructor] = true;
        emit InstructorUpdated(instructor, true);
    }

    /// @notice Revoke instructor privileges. Their active sessions become unusable for new attendance.
    function revokeInstructor(address instructor) external onlyAdmin {
        if (!instructors[instructor] || instructor == admin) revert NotAuthorized();
        instructors[instructor] = false;
        emit InstructorUpdated(instructor, false);
    }

    /// @notice Register a student. Instructors may register students for their institution.
    function registerStudent(address student) external onlyInstructor {
        if (student == address(0)) revert ZeroAddress();
        if (registeredStudents[student]) revert AlreadyAuthorized();
        registeredStudents[student] = true;
        emit StudentUpdated(student, true, msg.sender);
    }

    /// @notice Revoke a student's eligibility; historical attendance is not deleted.
    function revokeStudent(address student) external {
        if (!instructors[msg.sender]) revert Unauthorized();
        if (!registeredStudents[student]) revert NotAuthorized();
        registeredStudents[student] = false;
        emit StudentUpdated(student, false, msg.sender);
    }

    /// @notice Create a session with an inclusive start and exclusive end timestamp.
    function createSession(uint64 startsAt, uint64 endsAt)
        external
        onlyInstructor
        returns (uint256 sessionId)
    {
        if (startsAt >= endsAt || endsAt <= block.timestamp) {
            revert InvalidTimeRange();
        }

        sessionId = nextSessionId++;
        sessions[sessionId] = Session({
            instructor: msg.sender, startsAt: startsAt, endsAt: endsAt, qrNonce: 1, active: true
        });

        emit SessionCreated(sessionId, msg.sender, startsAt, endsAt, 1);
    }

    /// @notice Pause or resume a session. Only its creating instructor or admin may do so.
    function setSessionActive(uint256 sessionId, bool active) external {
        Session storage session = sessions[sessionId];
        if (session.instructor == address(0)) revert InvalidSession();
        if (msg.sender != admin && (msg.sender != session.instructor || !instructors[msg.sender])) {
            revert Unauthorized();
        }
        session.active = active;
        emit SessionStatusUpdated(sessionId, active);
    }

    /// @notice Invalidate all previously issued QR codes for a session.
    function rotateQrNonce(uint256 sessionId) external {
        Session storage session = sessions[sessionId];
        if (session.instructor == address(0)) revert InvalidSession();
        if (msg.sender != admin && (msg.sender != session.instructor || !instructors[msg.sender])) {
            revert Unauthorized();
        }
        if (session.qrNonce == type(uint64).max) revert InvalidQrNonce();
        unchecked {
            session.qrNonce += 1;
        }
        emit QrNonceRotated(sessionId, session.qrNonce);
    }

    /// @notice Record attendance using an instructor's EIP-712 signed QR authorization.
    /// @dev The same QR may be used by multiple registered students in the session. Each
    ///      student can attend only once per session. QR sharing cannot prove physical presence.
    function markAttendance(
        uint256 sessionId,
        uint64 expiresAt,
        uint64 qrNonce,
        bytes calldata signature
    ) external {
        if (!registeredStudents[msg.sender]) revert StudentNotRegistered();

        Session storage session = sessions[sessionId];
        if (session.instructor == address(0)) revert InvalidSession();
        if (!instructors[session.instructor]) revert Unauthorized();
        if (!session.active) revert SessionNotActive();
        if (block.timestamp < session.startsAt || block.timestamp >= session.endsAt) {
            revert SessionNotActive();
        }
        if (block.timestamp > expiresAt || expiresAt > session.endsAt) {
            revert AuthorizationExpired();
        }
        if (qrNonce != session.qrNonce) revert InvalidQrNonce();
        if (attendanceAt[sessionId][msg.sender] != 0) revert AlreadyAttended();

        bytes32 structHash = keccak256(
            abi.encode(ATTENDANCE_TYPEHASH, sessionId, uint256(qrNonce), uint256(expiresAt))
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _domainSeparator(), structHash));
        if (_recoverSigner(digest, signature) != session.instructor) revert InvalidSignature();

        uint64 recordedAt = uint64(block.timestamp);
        attendanceAt[sessionId][msg.sender] = recordedAt;
        emit AttendanceRecorded(sessionId, msg.sender, session.instructor, recordedAt);
    }

    function hasAttended(uint256 sessionId, address student) external view returns (bool) {
        return attendanceAt[sessionId][student] != 0;
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparator();
    }

    function _domainSeparator() private view returns (bytes32) {
        return keccak256(
            abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this))
        );
    }

    function _recoverSigner(bytes32 digest, bytes calldata signature)
        private
        pure
        returns (address signer)
    {
        if (signature.length != 65) revert InvalidSignature();

        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }

        if (uint256(s) > SECP256K1_HALF_ORDER || (v != 27 && v != 28)) {
            revert InvalidSignature();
        }

        signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert InvalidSignature();
    }
}
