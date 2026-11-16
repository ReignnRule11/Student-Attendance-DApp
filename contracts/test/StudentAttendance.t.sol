// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { StudentAttendance } from "../src/StudentAttendance.sol";

interface Vm {
    function addr(uint256 privateKey) external returns (address);
    function sign(uint256 privateKey, bytes32 digest)
        external
        returns (uint8 v, bytes32 r, bytes32 s);
    function warp(uint256 timestamp) external;
    function chainId(uint256 newChainId) external;
    function prank(address sender) external;
    function expectRevert(bytes4 revertData) external;
}

contract StudentAttendanceTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 private constant INSTRUCTOR_KEY = 0xA11CE;
    uint256 private constant OTHER_KEY = 0xB0B;
    uint256 private constant STUDENT_KEY = 0x5157;
    uint256 private constant OTHER_STUDENT_KEY = 0x5158;
    bytes32 private constant ATTENDANCE_TYPEHASH =
        keccak256("AttendanceAuthorization(uint256 sessionId,uint256 qrNonce,uint256 expiresAt)");

    StudentAttendance private attendance;
    address private instructor;
    address private student;
    address private otherStudent;
    uint256 private sessionId;
    uint64 private sessionEnd;

    function setUp() public {
        vm.warp(1_800_000_000);
        vm.chainId(11155111);
        instructor = vm.addr(INSTRUCTOR_KEY);
        student = vm.addr(STUDENT_KEY);
        otherStudent = vm.addr(OTHER_STUDENT_KEY);

        attendance = new StudentAttendance();
        attendance.authorizeInstructor(instructor);

        vm.prank(instructor);
        attendance.registerStudent(student);

        sessionEnd = uint64(block.timestamp + 1 hours);
        vm.prank(instructor);
        sessionId = attendance.createSession(uint64(block.timestamp - 10), sessionEnd);
    }

    function testRegisteredStudentCanMarkAttendance() public {
        uint64 expiry = uint64(block.timestamp + 5 minutes);
        bytes memory signature = _sign(INSTRUCTOR_KEY, sessionId, 1, expiry);

        vm.prank(student);
        attendance.markAttendance(sessionId, expiry, 1, signature);

        require(attendance.hasAttended(sessionId, student), "attendance missing");
        require(attendance.attendanceAt(sessionId, student) == block.timestamp, "wrong timestamp");
    }

    function testUnauthorizedAddressCannotRegisterStudent() public {
        vm.expectRevert(StudentAttendance.Unauthorized.selector);
        vm.prank(otherStudent);
        attendance.registerStudent(otherStudent);
    }

    function testUnregisteredStudentCannotMarkAttendance() public {
        uint64 expiry = uint64(block.timestamp + 5 minutes);
        bytes memory signature = _sign(INSTRUCTOR_KEY, sessionId, 1, expiry);

        vm.expectRevert(StudentAttendance.StudentNotRegistered.selector);
        vm.prank(otherStudent);
        attendance.markAttendance(sessionId, expiry, 1, signature);
    }

    function testDuplicateAttendanceIsRejected() public {
        uint64 expiry = uint64(block.timestamp + 5 minutes);
        bytes memory signature = _sign(INSTRUCTOR_KEY, sessionId, 1, expiry);

        vm.prank(student);
        attendance.markAttendance(sessionId, expiry, 1, signature);

        vm.expectRevert(StudentAttendance.AlreadyAttended.selector);
        vm.prank(student);
        attendance.markAttendance(sessionId, expiry, 1, signature);
    }

    function testExpiredQrAuthorizationIsRejected() public {
        uint64 expiry = uint64(block.timestamp - 1);
        bytes memory signature = _sign(INSTRUCTOR_KEY, sessionId, 1, expiry);

        vm.expectRevert(StudentAttendance.AuthorizationExpired.selector);
        vm.prank(student);
        attendance.markAttendance(sessionId, expiry, 1, signature);
    }

    function testForgedInstructorSignatureIsRejected() public {
        uint64 expiry = uint64(block.timestamp + 5 minutes);
        bytes memory signature = _sign(OTHER_KEY, sessionId, 1, expiry);

        vm.expectRevert(StudentAttendance.InvalidSignature.selector);
        vm.prank(student);
        attendance.markAttendance(sessionId, expiry, 1, signature);
    }

    function testSignatureCannotBeReplayedAcrossSessions() public {
        uint64 expiry = uint64(block.timestamp + 5 minutes);
        bytes memory signatureForFirstSession = _sign(INSTRUCTOR_KEY, sessionId, 1, expiry);

        vm.prank(instructor);
        uint256 secondSessionId = attendance.createSession(uint64(block.timestamp - 1), sessionEnd);

        vm.expectRevert(StudentAttendance.InvalidSignature.selector);
        vm.prank(student);
        attendance.markAttendance(secondSessionId, expiry, 1, signatureForFirstSession);
    }

    function testRotatingQrNonceInvalidatesOldQr() public {
        uint64 expiry = uint64(block.timestamp + 5 minutes);
        bytes memory oldSignature = _sign(INSTRUCTOR_KEY, sessionId, 1, expiry);

        vm.prank(instructor);
        attendance.rotateQrNonce(sessionId);

        vm.expectRevert(StudentAttendance.InvalidQrNonce.selector);
        vm.prank(student);
        attendance.markAttendance(sessionId, expiry, 1, oldSignature);
    }

    function testSignatureIsBoundToSepoliaChainId() public {
        uint64 expiry = uint64(block.timestamp + 5 minutes);
        bytes memory sepoliaSignature = _sign(INSTRUCTOR_KEY, sessionId, 1, expiry);

        vm.chainId(1);
        vm.expectRevert(StudentAttendance.InvalidSignature.selector);
        vm.prank(student);
        attendance.markAttendance(sessionId, expiry, 1, sepoliaSignature);
    }

    function testPausedSessionRejectsAttendance() public {
        vm.prank(instructor);
        attendance.setSessionActive(sessionId, false);

        uint64 expiry = uint64(block.timestamp + 5 minutes);
        bytes memory signature = _sign(INSTRUCTOR_KEY, sessionId, 1, expiry);

        vm.expectRevert(StudentAttendance.SessionNotActive.selector);
        vm.prank(student);
        attendance.markAttendance(sessionId, expiry, 1, signature);
    }

    function testRevokedStudentCannotMarkAttendance() public {
        vm.prank(instructor);
        attendance.revokeStudent(student);

        uint64 expiry = uint64(block.timestamp + 5 minutes);
        bytes memory signature = _sign(INSTRUCTOR_KEY, sessionId, 1, expiry);

        vm.expectRevert(StudentAttendance.StudentNotRegistered.selector);
        vm.prank(student);
        attendance.markAttendance(sessionId, expiry, 1, signature);
    }

    function testFuzzValidExpiryRecordsAttendance(uint64 ttlSeed) public {
        uint64 ttl = uint64(uint256(ttlSeed) % 3_600 + 1);
        uint64 expiry = uint64(block.timestamp) + ttl;
        bytes memory signature = _sign(INSTRUCTOR_KEY, sessionId, 1, expiry);

        vm.prank(student);
        attendance.markAttendance(sessionId, expiry, 1, signature);

        require(attendance.hasAttended(sessionId, student), "fuzzed valid attendance missing");
    }

    function testFuzzNonceRotationInvalidatesOriginalAuthorization(uint8 rotationSeed) public {
        uint8 rotations = uint8(uint256(rotationSeed) % 8 + 1);
        uint64 expiry = uint64(block.timestamp + 5 minutes);
        bytes memory originalSignature = _sign(INSTRUCTOR_KEY, sessionId, 1, expiry);

        for (uint256 i; i < rotations; ++i) {
            vm.prank(instructor);
            attendance.rotateQrNonce(sessionId);
        }

        vm.expectRevert(StudentAttendance.InvalidQrNonce.selector);
        vm.prank(student);
        attendance.markAttendance(sessionId, expiry, 1, originalSignature);
    }

    function testFuzzDuplicateAttendanceAlwaysReverts(uint64 ttlSeed) public {
        uint64 ttl = uint64(uint256(ttlSeed) % 3_600 + 1);
        uint64 expiry = uint64(block.timestamp) + ttl;
        bytes memory signature = _sign(INSTRUCTOR_KEY, sessionId, 1, expiry);

        vm.prank(student);
        attendance.markAttendance(sessionId, expiry, 1, signature);

        vm.expectRevert(StudentAttendance.AlreadyAttended.selector);
        vm.prank(student);
        attendance.markAttendance(sessionId, expiry, 1, signature);
    }

    function testSessionEndTimestampIsExclusive() public {
        vm.warp(sessionEnd);
        bytes memory signature = _sign(INSTRUCTOR_KEY, sessionId, 1, sessionEnd);

        vm.expectRevert(StudentAttendance.SessionNotActive.selector);
        vm.prank(student);
        attendance.markAttendance(sessionId, sessionEnd, 1, signature);
    }

    function testSessionStartTimestampIsInclusive() public {
        (, uint64 startsAt,,,) = attendance.sessions(sessionId);
        vm.warp(startsAt);
        uint64 expiry = uint64(startsAt + 60);
        bytes memory signature = _sign(INSTRUCTOR_KEY, sessionId, 1, expiry);

        vm.prank(student);
        attendance.markAttendance(sessionId, expiry, 1, signature);

        require(attendance.hasAttended(sessionId, student), "start boundary should be inclusive");
    }

    function testUnauthorizedWalletCannotPauseOrRotateSession() public {
        vm.expectRevert(StudentAttendance.Unauthorized.selector);
        vm.prank(otherStudent);
        attendance.setSessionActive(sessionId, false);

        vm.expectRevert(StudentAttendance.Unauthorized.selector);
        vm.prank(otherStudent);
        attendance.rotateQrNonce(sessionId);
    }

    function testRevokedInstructorCannotCreateNewSession() public {
        vm.prank(address(this));
        attendance.revokeInstructor(instructor);

        vm.expectRevert(StudentAttendance.Unauthorized.selector);
        vm.prank(instructor);
        attendance.createSession(uint64(block.timestamp + 1), uint64(block.timestamp + 1 hours));
    }


    function testAdminTransferRequiresProposalAndAcceptance() public {
        address proposed = vm.addr(OTHER_KEY);

        attendance.proposeAdmin(proposed);
        require(attendance.pendingAdmin() == proposed, "pending admin not recorded");

        vm.expectRevert(StudentAttendance.NoPendingAdmin.selector);
        vm.prank(student);
        attendance.acceptAdmin();

        vm.prank(proposed);
        attendance.acceptAdmin();

        require(attendance.admin() == proposed, "admin transfer failed");
        require(attendance.instructors(proposed), "new admin lacks instructor access");
        require(attendance.pendingAdmin() == address(0), "pending admin not cleared");

        vm.expectRevert(StudentAttendance.Unauthorized.selector);
        attendance.authorizeInstructor(otherStudent);
    }

    function testAdminCannotProposeZeroAddress() public {
        vm.expectRevert(StudentAttendance.ZeroAddress.selector);
        attendance.proposeAdmin(address(0));
    }

    function testRevokedInstructorCannotUseExistingSessionQr() public {
        uint64 expiry = uint64(block.timestamp + 5 minutes);
        bytes memory signature = _sign(INSTRUCTOR_KEY, sessionId, 1, expiry);

        attendance.revokeInstructor(instructor);

        vm.expectRevert(StudentAttendance.Unauthorized.selector);
        vm.prank(student);
        attendance.markAttendance(sessionId, expiry, 1, signature);
    }

    function testRevokedInstructorCannotManageExistingSession() public {
        attendance.revokeInstructor(instructor);

        vm.expectRevert(StudentAttendance.Unauthorized.selector);
        vm.prank(instructor);
        attendance.rotateQrNonce(sessionId);

        vm.expectRevert(StudentAttendance.Unauthorized.selector);
        vm.prank(instructor);
        attendance.setSessionActive(sessionId, false);
    }

    function _sign(uint256 privateKey, uint256 id, uint64 nonce, uint64 expiry)
        private
        returns (bytes memory)
    {
        bytes32 structHash =
            keccak256(abi.encode(ATTENDANCE_TYPEHASH, id, uint256(nonce), uint256(expiry)));
        bytes32 digest =
            keccak256(abi.encodePacked("\x19\x01", attendance.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        return abi.encodePacked(r, s, v);
    }
}
