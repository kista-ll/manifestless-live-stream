from __future__ import annotations

import json
import struct
from dataclasses import dataclass
from enum import IntEnum, StrEnum
from typing import Any

PROTOCOL_VERSION = 1
STREAM_ID = "live-001"
MIME_TYPE = 'video/mp4; codecs="avc1.64001f,mp4a.40.2"'
FRAME_MAGIC = b"MLSP"
FRAME_HEADER_SIZE = 32
MAX_PAYLOAD_LENGTH = 10 * 1024 * 1024


class ApplicationCloseCode(IntEnum):
    NORMAL_END = 0x100
    CAPACITY_EXCEEDED = 0x101
    INVALID_CLIENT_MESSAGE = 0x102
    STREAM_NOT_READY = 0x103
    PROTOCOL_VERSION_MISMATCH = 0x104
    INTERNAL_ERROR = 0x105


class BinaryFrameType(IntEnum):
    INIT = 0x01
    MEDIA = 0x02


class ControlMessageType(StrEnum):
    CLIENT_HELLO = "client_hello"
    STREAM_INIT = "stream_init"
    SEGMENT_AVAILABLE = "segment_available"
    DISCONTINUITY = "discontinuity"
    STREAM_ENDED = "stream_ended"
    CAPACITY_EXCEEDED = "capacity_exceeded"
    ERROR = "error"


@dataclass(frozen=True, slots=True)
class BinaryFrame:
    frame_type: BinaryFrameType
    sequence: int
    pts_ms: int
    duration_ms: int
    payload: bytes
    independent: bool = True


@dataclass(frozen=True, slots=True)
class DecodedBinaryFrame(BinaryFrame):
    version: int = PROTOCOL_VERSION


class ProtocolError(ValueError):
    pass


class NdjsonDecoder:
    def __init__(self) -> None:
        self._buffer = ""

    def feed(self, data: bytes) -> list[dict[str, Any]]:
        self._buffer += data.decode("utf-8")
        messages: list[dict[str, Any]] = []

        while "\n" in self._buffer:
            line, self._buffer = self._buffer.split("\n", 1)
            if line == "":
                continue
            value = json.loads(line)
            if not isinstance(value, dict):
                raise ProtocolError("control message must be a JSON object")
            messages.append(value)

        return messages


def encode_control_message(message: dict[str, Any]) -> bytes:
    if "type" not in message:
        raise ProtocolError("control message requires type")
    return (json.dumps(message, separators=(",", ":"), ensure_ascii=False) + "\n").encode("utf-8")


def client_hello(client_id: str, last_sequence: int | None = None) -> dict[str, Any]:
    return {
        "type": ControlMessageType.CLIENT_HELLO.value,
        "protocolVersion": PROTOCOL_VERSION,
        "clientId": client_id,
        "lastSequence": last_sequence,
    }


def validate_client_hello(message: dict[str, Any]) -> None:
    if message.get("type") != ControlMessageType.CLIENT_HELLO:
        raise ProtocolError("expected client_hello")
    if message.get("protocolVersion") != PROTOCOL_VERSION:
        raise ProtocolError("protocol version mismatch")
    if not isinstance(message.get("clientId"), str) or message["clientId"] == "":
        raise ProtocolError("clientId is required")


def stream_init(latest_sequence: int, start_sequence: int) -> dict[str, Any]:
    return {
        "type": ControlMessageType.STREAM_INIT.value,
        "protocolVersion": PROTOCOL_VERSION,
        "streamId": STREAM_ID,
        "mimeType": MIME_TYPE,
        "segmentDurationMs": 1000,
        "latestSequence": latest_sequence,
        "startSequence": start_sequence,
        "targetLatencyMs": 2500,
        "maxLatencyMs": 5000,
    }


def segment_available(sequence: int) -> dict[str, Any]:
    return {"type": ControlMessageType.SEGMENT_AVAILABLE.value, "sequence": sequence}


def discontinuity(
    reason: str,
    next_sequence: int,
    *,
    requires_new_init_segment: bool,
) -> dict[str, Any]:
    return {
        "type": ControlMessageType.DISCONTINUITY.value,
        "reason": reason,
        "nextSequence": next_sequence,
        "requiresNewInitSegment": requires_new_init_segment,
    }


def stream_ended(last_sequence: int) -> dict[str, Any]:
    return {"type": ControlMessageType.STREAM_ENDED.value, "lastSequence": last_sequence}


def capacity_exceeded(limit: int = 10) -> dict[str, Any]:
    return {"type": ControlMessageType.CAPACITY_EXCEEDED.value, "limit": limit}


def error_message(code: str, message: str) -> dict[str, Any]:
    return {"type": ControlMessageType.ERROR.value, "code": code, "message": message}


def encode_binary_frame(frame: BinaryFrame) -> bytes:
    payload_length = len(frame.payload)
    if payload_length > MAX_PAYLOAD_LENGTH:
        raise ProtocolError("payload exceeds 10 MiB limit")
    if frame.frame_type is BinaryFrameType.INIT and frame.sequence != 0:
        raise ProtocolError("init frame sequence must be 0")
    if frame.frame_type is BinaryFrameType.MEDIA and frame.sequence < 1:
        raise ProtocolError("media frame sequence must be 1 or greater")

    flags = 0x01 if frame.independent else 0x00
    header = struct.pack(
        "!4sBBHQQII",
        FRAME_MAGIC,
        PROTOCOL_VERSION,
        frame.frame_type,
        flags,
        frame.sequence,
        frame.pts_ms,
        frame.duration_ms,
        payload_length,
    )
    return header + frame.payload


def decode_binary_frame(data: bytes) -> DecodedBinaryFrame:
    if len(data) < FRAME_HEADER_SIZE:
        raise ProtocolError("binary frame is shorter than header")

    magic, version, frame_type_value, flags, sequence, pts_ms, duration_ms, payload_length = (
        struct.unpack("!4sBBHQQII", data[:FRAME_HEADER_SIZE])
    )

    if magic != FRAME_MAGIC:
        raise ProtocolError("invalid frame magic")
    if version != PROTOCOL_VERSION:
        raise ProtocolError("binary frame protocol version mismatch")
    if payload_length > MAX_PAYLOAD_LENGTH:
        raise ProtocolError("payload exceeds 10 MiB limit")
    if len(data) - FRAME_HEADER_SIZE != payload_length:
        raise ProtocolError("payload length mismatch")

    try:
        frame_type = BinaryFrameType(frame_type_value)
    except ValueError as exc:
        raise ProtocolError("unknown binary frame type") from exc

    return DecodedBinaryFrame(
        frame_type=frame_type,
        sequence=sequence,
        pts_ms=pts_ms,
        duration_ms=duration_ms,
        payload=data[FRAME_HEADER_SIZE:],
        independent=bool(flags & 0x01),
        version=version,
    )
