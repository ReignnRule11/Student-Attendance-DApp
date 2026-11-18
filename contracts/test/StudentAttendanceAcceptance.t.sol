// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { StudentAttendance } from "../src/StudentAttendance.sol";

interface VmAcceptance {
    function addr(uint256 privateKey) external returns (address);
    function sign(uint256 privateKey, bytes32 digest)
        external
        returns (uint8 v, bytes32 r, bytes32 s);
    function warp(uint256 timestamp) external;
    function chainId(uint256 newChainId) external;
    function prank(address sender) external;
    function expectRevert(bytes4 revertData) external;
}

/// @notice Integrated local acceptance tests using independent admin, instructor,
/// student, and second-student identities. No live network or real wallet is used.
contract StudentAttendanceAcceptanceTest {
    VmAcceptance private constant vm =
        VmAcceptance(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 private constant INSTRUCTOR_KEY = 0xA11CE;
    uint256 private constant STUDENT_KEY = 0x5157;
    uint256 private constant SECOND_STUDENT_KEY = 0x5158;
    uint256 private constant UNREGISTERED_KEY = 0x5159;
    uint256 private constant OTHER_SIGNER_KEY = 0xB0B;

    bytes32 private constant ATTENDANCE_TYPEHASH =
        keccak256("AttendanceAuthorization(uint256 sessionId,uint256 qrNonce,uint256 expiresAt)");

    StudentAttendance private attendance;
    address private instructor;
    address private student;
    address private secondStudent;
    address private unregisteredStudent;
    uint256 private sessionId;
    uint64 private sessionEnd;

    function setUp() public {
        vm.warp(1_800_000_000);
        vm.chainId(11155111);

        instructor = vm.addr(INSTRUCTOR_KEY);
        student = vm.addr(STUDENT_KEY);
        secondStudent = vm.addr(SECOND_STUDENT_KEY);
        unregisteredStudent = vm.addr(UNREGISTERED_KEY);

        attendance = new StudentAttendance();
        attendance.authorizeInstructor(instructor);

        vm.prank(instructor);
        attendance.registerStudent(student);
        vm.prank(instructor);
        attendance.registerStudent(secondStudent);

        sessionEnd = uint64(block.timestamp + 1 hours);
        vm.prank(instructor);
        sessionId = attendance.createSession(uint64(block.timestamp - 1), sessionEnd);
    }

    /// @notice One signed QR can serve multiple registered students, but not twice
    /// for the same student in the same session.
    function testFullLifecycleAllowsTwoStudentsAndRejectsDuplicate() public {
        uint64 expiry = uint64(block.timestamp + 5 minutes);
        bytes memory qrSignature = _sign(INSTRUCTOR_KEY, 1, expiry);

        vm.prank(student);
        attendance.markAttendance(sessionId, expiry, 1, qrSignature);
        vm.prank(secondStudent);
        attendance.markAttendance(sessionId, expiry, 1, qrSignature);

        require(attendance.hasAttended(sessionId, student), "first student missing");
        require(attendance.hasAttended(sessionId, secondStudent), "second student missing");
        require(attendance.attendanceAt(sessionId, student) != 0, "first timestamp missing");
        require(attendance.attendanceAt(sessionId, secondStudent) != 0, "second timestamp missing");

        vm.expectRevert(StudentAttendance.AlreadyAttended.selector);
        vm.prank(student);
        attendance.markAttendance(sessionId, expiry, 1, qrSignature);
    }

    function testAcceptanceRejectsUnregisteredWallet() public {
        uint64 expiry = uint64(block.timestamp + 5 minutes);
        bytes memory signature = _sign(INSTRUCTOR_KEY, 1, expiry);

        vm.expectRevert(StudentAttendance.StudentNotRegistered.selector);
        vm.prank(unregisteredStudent);
        attendance.markAttendance(sessionId, expiry, 1, signature);
    }

    function testAcceptanceRejectsExpiredQr() public {
        uint64 expiry = uint64(block.timestamp - 1);
        bytes memory signature = _sign(INSTRUCTOR_KEY, 1, expiry);

        vm.expectRevert(StudentAttendance.AuthorizationExpired.selector);
        vm.prank(student);
        attendance.markAttendance(sessionId, expiry, 1, signature);
    }

    function testAcceptanceRejectsQrAfterNonceRotation() public {
        uint64 expiry = uint64(block.timestamp + 5 minutes);
        bytes memory oldSignature = _sign(INSTRUCTOR_KEY, 1, expiry);

        vm.prank(instructor);
        attendance.rotateQrNonce(sessionId);

        vm.expectRevert(StudentAttendance.InvalidQrNonce.selector);
        vm.prank(student);
        attendance.markAttendance(sessionId, expiry, 1, oldSignature);
    }

    function testAcceptanceRejectsPausedSession() public {
        vm.prank(instructor);
        attendance.setSessionActive(sessionId, false);

        uint64 expiry = uint64(block.timestamp + 5 minutes);
        bytes memory signature = _sign(INSTRUCTOR_KEY, 1, expiry);

        vm.expectRevert(StudentAttendance.SessionNotActive.selector);
        vm.prank(student);
        attendance.markAttendance(sessionId, expiry, 1, signature);
    }

    function testAcceptanceRejectsRevokedInstructor() public {
        attendance.revokeInstructor(instructor);

        uint64 expiry = uint64(block.timestamp + 5 minutes);
        bytes memory signature = _sign(INSTRUCTOR_KEY, 1, expiry);

        vm.expectRevert(StudentAttendance.Unauthorized.selector);
        vm.prank(student);
        attendance.markAttendance(sessionId, expiry, 1, signature);
    }

    function testAcceptanceRejectsSignatureFromWrongWallet() public {
        uint64 expiry = uint64(block.timestamp + 5 minutes);
        bytes memory signature = _sign(OTHER_SIGNER_KEY, 1, expiry);

        vm.expectRevert(StudentAttendance.InvalidSignature.selector);
        vm.prank(student);
        attendance.markAttendance(sessionId, expiry, 1, signature);
    }

    function _sign(uint256 signingKey, uint64 nonce, uint64 expiry)
        private
        returns (bytes memory)
    {
        bytes32 structHash =
            keccak256(abi.encode(ATTENDANCE_TYPEHASH, sessionId, uint256(nonce), uint256(expiry)));
        bytes32 digest =
            keccak256(abi.encodePacked("\x19\x01", attendance.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signingKey, digest);
        return abi.encodePacked(r, s, v);
    }
}
