import struct

import pytest

from manifestless_server.protocol import (
    FRAME_HEADER_SIZE,
    MAX_PAYLOAD_LENGTH,
    ApplicationCloseCode,
    BinaryFrame,
    BinaryFrameType,
    NdjsonDecoder,
    ProtocolError,
    capacity_exceeded,
    client_hello,
    decode_binary_frame,
    discontinuity,
    encode_binary_frame,
    encode_control_message,
    error_message,
    segment_available,
    stream_ended,
    stream_init,
    validate_client_hello,
)


def test_ndjson_decoder_handles_fragmented_messages() -> None:
    decoder = NdjsonDecoder()
    encoded = encode_control_message(client_hello("client-1"))

    assert decoder.feed(encoded[:5]) == []
    messages = decoder.feed(encoded[5:])

    assert messages == [client_hello("client-1")]


def test_all_protocol_control_messages_encode_as_ndjson() -> None:
    messages = [
        client_hello("client-1"),
        stream_init(latest_sequence=120, start_sequence=118),
        segment_available(sequence=121),
        discontinuity("slow_consumer", 125, requires_new_init_segment=False),
        stream_ended(last_sequence=150),
        capacity_exceeded(limit=10),
        error_message("STREAM_NOT_READY", "init segment is not available"),
    ]

    decoder = NdjsonDecoder()
    encoded = b"".join(encode_control_message(message) for message in messages)

    assert decoder.feed(encoded) == messages


def test_client_hello_version_check() -> None:
    message = client_hello("client-1")
    validate_client_hello(message)
    message["protocolVersion"] = 2

    with pytest.raises(ProtocolError, match="version"):
        validate_client_hello(message)


def test_binary_frame_round_trip_for_init_and_media() -> None:
    init = BinaryFrame(
        frame_type=BinaryFrameType.INIT,
        sequence=0,
        pts_ms=0,
        duration_ms=0,
        payload=b"init",
    )
    media = BinaryFrame(
        frame_type=BinaryFrameType.MEDIA,
        sequence=123,
        pts_ms=122000,
        duration_ms=1000,
        payload=b"media",
    )

    assert decode_binary_frame(encode_binary_frame(init)).payload == b"init"
    decoded_media = decode_binary_frame(encode_binary_frame(media))

    assert decoded_media.frame_type is BinaryFrameType.MEDIA
    assert decoded_media.sequence == 123
    assert decoded_media.pts_ms == 122000
    assert decoded_media.duration_ms == 1000
    assert decoded_media.independent is True


def test_binary_header_uses_specified_size_and_big_endian() -> None:
    frame = BinaryFrame(
        frame_type=BinaryFrameType.MEDIA,
        sequence=1,
        pts_ms=0,
        duration_ms=1000,
        payload=b"x",
    )
    encoded = encode_binary_frame(frame)

    assert len(encoded[:FRAME_HEADER_SIZE]) == 32
    assert encoded[:4] == b"MLSP"
    assert struct.unpack("!Q", encoded[8:16]) == (1,)
    assert struct.unpack("!I", encoded[28:32]) == (1,)


def test_binary_frame_rejects_payload_over_10_mib() -> None:
    frame = BinaryFrame(
        frame_type=BinaryFrameType.MEDIA,
        sequence=1,
        pts_ms=0,
        duration_ms=1000,
        payload=b"x" * (MAX_PAYLOAD_LENGTH + 1),
    )

    with pytest.raises(ProtocolError, match="10 MiB"):
        encode_binary_frame(frame)


def test_binary_decoder_rejects_invalid_magic_and_length() -> None:
    frame = encode_binary_frame(
        BinaryFrame(
            frame_type=BinaryFrameType.MEDIA,
            sequence=1,
            pts_ms=0,
            duration_ms=1000,
            payload=b"x",
        )
    )

    with pytest.raises(ProtocolError, match="magic"):
        decode_binary_frame(b"NOPE" + frame[4:])

    with pytest.raises(ProtocolError, match="length"):
        decode_binary_frame(frame[:-1])


def test_application_close_codes_match_protocol() -> None:
    assert int(ApplicationCloseCode.NORMAL_END) == 0x100
    assert int(ApplicationCloseCode.CAPACITY_EXCEEDED) == 0x101
    assert int(ApplicationCloseCode.INVALID_CLIENT_MESSAGE) == 0x102
    assert int(ApplicationCloseCode.STREAM_NOT_READY) == 0x103
    assert int(ApplicationCloseCode.PROTOCOL_VERSION_MISMATCH) == 0x104
    assert int(ApplicationCloseCode.INTERNAL_ERROR) == 0x105
