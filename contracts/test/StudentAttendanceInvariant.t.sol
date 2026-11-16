// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { StudentAttendance } from "../src/StudentAttendance.sol";

interface VmInvariant {
    function addr(uint256 privateKey) external returns (address);
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
    function warp(uint256 timestamp) external;
    function chainId(uint256 newChainId) external;
    function prank(address sender) external;
    function targetContract(address target) external;
}

contract AttendanceInvariantHandler {
    VmInvariant private constant vm = VmInvariant(address(uint160(uint256(keccak256("hevm cheat code")))));
    bytes32 private constant TYPEHASH = keccak256("AttendanceAuthorization(uint256 sessionId,uint256 qrNonce,uint256 expiresAt)");
    StudentAttendance public immutable attendance;
    address public immutable instructor;
    address public immutable student;
    uint256 public immutable instructorKey;
    uint256 public immutable sessionId;
    uint64 public firstRecordedAt;

    constructor(StudentAttendance a, address i, address s, uint256 key, uint256 id) {
        attendance = a;
        instructor = i;
        student = s;
        instructorKey = key;
        sessionId = id;
    }

    function attemptAttendance(uint64 ttlSeed) external {
        (address sessionInstructor,, uint64 endsAt, uint64 nonce, bool active) = attendance.sessions(sessionId);
        if (!active || sessionInstructor != instructor || block.timestamp >= endsAt ||
            !attendance.registeredStudents(student) || attendance.hasAttended(sessionId, student)) return;
        uint64 expiry = uint64(block.timestamp + uint256(ttlSeed) % 300 + 1);
        if (expiry > endsAt) expiry = endsAt;
        bytes32 structHash = keccak256(abi.encode(TYPEHASH, sessionId, uint256(nonce), uint256(expiry)));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", attendance.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 sigS) = vm.sign(instructorKey, digest);
        vm.prank(student);
        try attendance.markAttendance(sessionId, expiry, nonce, abi.encodePacked(r, sigS, v)) { } catch { }
        uint64 recorded = attendance.attendanceAt(sessionId, student);
        if (firstRecordedAt == 0 && recorded != 0) firstRecordedAt = recorded;
    }

    function rotateNonce() external {
        vm.prank(instructor);
        try attendance.rotateQrNonce(sessionId) { } catch { }
    }

    function toggleSession(bool active) external {
        vm.prank(instructor);
        try attendance.setSessionActive(sessionId, active) { } catch { }
    }
}

contract StudentAttendanceInvariantTest {
    VmInvariant private constant vm = VmInvariant(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant INSTRUCTOR_KEY = 0xA11CE;
    uint256 private constant STUDENT_KEY = 0x5157;
    StudentAttendance private attendance;
    AttendanceInvariantHandler private handler;
    uint256 private sessionId;
    address private student;

    function setUp() public {
        vm.warp(1_800_000_000);
        vm.chainId(11155111);
        address instructor = vm.addr(INSTRUCTOR_KEY);
        student = vm.addr(STUDENT_KEY);
        attendance = new StudentAttendance();
        attendance.authorizeInstructor(instructor);
        vm.prank(instructor);
        attendance.registerStudent(student);
        vm.prank(instructor);
        sessionId = attendance.createSession(uint64(block.timestamp - 1), uint64(block.timestamp + 1 days));
        handler = new AttendanceInvariantHandler(attendance, instructor, student, INSTRUCTOR_KEY, sessionId);
        vm.targetContract(address(handler));
    }

    function invariant_attendanceFlagMatchesRecordedTimestamp() public view {
        require(attendance.hasAttended(sessionId, student) == (attendance.attendanceAt(sessionId, student) != 0),
            "attendance flag/timestamp diverged");
    }

    function invariant_recordedAttendanceNeverChanges() public view {
        uint64 first = handler.firstRecordedAt();
        if (first != 0) require(attendance.attendanceAt(sessionId, student) == first, "attendance timestamp mutated");
    }

    function invariant_qrNonceNeverReturnsToZero() public view {
        (,,, uint64 nonce,) = attendance.sessions(sessionId);
        require(nonce >= 1, "QR nonce became zero");
    }
}
