from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
from pathlib import Path

from aioquic.asyncio.server import QuicServer, serve

from manifestless_server.certs import ensure_localhost_cert
from manifestless_server.domain import Metrics, SegmentRingBuffer, SegmentWatcher, ViewerRegistry
from manifestless_server.transport.webtransport import (
    AioquicWebTransportProtocol,
    WebTransportStreamService,
    create_quic_configuration,
)

LOGGER = logging.getLogger("manifestless_server.e2e")

REQUIRED_VIDEO_CODEC = "h264"
REQUIRED_AUDIO_CODEC = "aac"


def init_segment_id(payload: bytes | None, generation: int) -> str | None:
    if payload is None:
        return None
    return f"{generation}-{len(payload)}-{hashlib.sha256(payload).hexdigest()[:16]}"


async def handle_api_stream(
    reader: asyncio.StreamReader,
    writer: asyncio.StreamWriter,
    *,
    viewers: ViewerRegistry,
    ring_buffer: SegmentRingBuffer,
    metrics: Metrics,
    stream_service: WebTransportStreamService,
    stream_state: dict[str, str],
    ingest_state: dict[str, object],
    init_state: dict[str, str | None],
) -> None:
    request = await reader.readline()
    while True:
        line = await reader.readline()
        if line in {b"\r\n", b"\n", b""}:
            break
    parts = request.decode("ascii", errors="ignore").split(" ")
    method = parts[0] if len(parts) > 0 else ""
    path = parts[1] if len(parts) > 1 else ""
    if method == "GET" and path == "/api/health":
        body = b'{"status":"ok"}'
        writer.write(
            b"HTTP/1.1 200 OK\r\n"
            b"content-type: application/json\r\n"
            + f"content-length: {len(body)}\r\n\r\n".encode("ascii")
            + body
        )
        await writer.drain()
        writer.close()
        await writer.wait_closed()
        return
    if method == "POST" and path == "/api/stream/end":
        stream_state["state"] = "ENDING"
        await stream_service.end_stream()
        stream_state["state"] = "ENDED"
        body = b'{"accepted":true}'
        writer.write(
            b"HTTP/1.1 202 Accepted\r\n"
            b"content-type: application/json\r\n"
            + f"content-length: {len(body)}\r\n\r\n".encode("ascii")
            + body
        )
        await writer.drain()
        writer.close()
        await writer.wait_closed()
        return
    if method == "GET" and path == "/api/ingest":
        body = json.dumps(ingest_state).encode("utf-8")
        writer.write(
            b"HTTP/1.1 200 OK\r\n"
            b"content-type: application/json\r\n"
            + f"content-length: {len(body)}\r\n\r\n".encode("ascii")
            + body
        )
        await writer.drain()
        writer.close()
        await writer.wait_closed()
        return
    if method != "GET" or path != "/api/stream":
        body = b'{"error":"not_found"}'
        writer.write(
            b"HTTP/1.1 404 Not Found\r\n"
            b"content-type: application/json\r\n"
            + f"content-length: {len(body)}\r\n\r\n".encode("ascii")
            + body
        )
        await writer.drain()
        writer.close()
        await writer.wait_closed()
        return
    body = json.dumps(
        {
            "streamId": "live-001",
            "state": stream_state["state"],
            "viewerCount": viewers.count,
            "viewerLimit": viewers.limit,
            "oldestSequence": ring_buffer.oldest_sequence,
            "latestSequence": ring_buffer.latest_sequence,
            "segmentCount": ring_buffer.segment_count,
            "viewerRejectedTotal": metrics.viewer_rejected_total,
            "initSegmentId": init_state["id"],
            "ingest": ingest_state,
        }
    ).encode("utf-8")
    writer.write(
        b"HTTP/1.1 200 OK\r\n"
        b"content-type: application/json\r\n"
        + f"content-length: {len(body)}\r\n\r\n".encode("ascii")
        + body
    )
    await writer.drain()
    writer.close()
    await writer.wait_closed()


async def watch_media(
    *,
    media_dir: Path,
    ring_buffer: SegmentRingBuffer,
    stream_service: WebTransportStreamService,
    stream_state: dict[str, str],
    ingest_state: dict[str, object],
    init_state: dict[str, str | None],
) -> None:
    watcher = SegmentWatcher(media_dir=media_dir, ring_buffer=ring_buffer)
    last_init_mtime: float | None = None
    last_segment_at: float | None = None
    interrupted = False
    reinit_pending = False
    probe_checked = False
    while True:
        if stream_state["state"] == "ENDED":
            await asyncio.sleep(0.2)
            continue
        init_path = media_dir / "init.mp4"
        if init_path.exists():
            mtime = init_path.stat().st_mtime
            if last_init_mtime != mtime:
                payload = init_path.read_bytes()
                if interrupted:
                    ring_buffer.clear()
                    watcher = SegmentWatcher(media_dir=media_dir, ring_buffer=ring_buffer)
                    reinit_pending = True
                    interrupted = False
                generation = int(init_state["generation"] or "0") + 1
                init_state["generation"] = str(generation)
                init_state["id"] = init_segment_id(payload, generation)
                stream_service.update_init_segment(payload, init_state["id"])
                last_init_mtime = mtime
                ingest_state["state"] = "CONNECTED"
                ingest_state["lastError"] = None
                stream_state["state"] = "STARTING"
                LOGGER.info(
                    "ingest_connected",
                    extra={"init_segment_id": init_state["id"]},
                )
        elif interrupted:
            last_init_mtime = None
        for segment in watcher.scan_once():
            if interrupted:
                continue
            ingest_state["state"] = "CONNECTED"
            ingest_state["lastError"] = None
            stream_state["state"] = "LIVE"
            last_segment_at = asyncio.get_running_loop().time()
            if reinit_pending:
                await stream_service.reinitialize_sessions()
                reinit_pending = False
            await stream_service.push_segment(segment)
        now = asyncio.get_running_loop().time()
        if (
            last_segment_at is not None
            and not interrupted
            and stream_state["state"] == "LIVE"
            and now - last_segment_at > 2.5
        ):
            interrupted = True
            ingest_state["state"] = "INTERRUPTED"
            stream_state["state"] = "INTERRUPTED"
            await stream_service.notify_discontinuity(
                reason="ingest_interrupted",
                next_sequence=1,
            )
            LOGGER.info(
                "ingest_disconnected",
                extra={"latest_sequence": ring_buffer.latest_sequence},
            )
        probe_path = media_dir / "probe.ts"
        if probe_path.exists() and not probe_checked and probe_path.stat().st_size > 0:
            await asyncio.sleep(0.5)
            if probe_path.exists() and probe_path.stat().st_size > 0:
                probe_checked = True
                error = await validate_probe_file(probe_path)
                if error is not None:
                    ingest_state["state"] = "ERROR"
                    ingest_state["lastError"] = error
                    stream_state["state"] = "ERROR"
                    LOGGER.info(
                        "ingest_probe_failed",
                        extra={"error_code": error["code"], "error_detail": error["message"]},
                    )
        await asyncio.sleep(0.2)


async def validate_probe_file(path: Path) -> dict[str, str] | None:
    process = await asyncio.create_subprocess_exec(
        "ffprobe",
        "-v",
        "error",
        "-show_streams",
        "-of",
        "json",
        str(path),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await process.communicate()
    if process.returncode != 0:
        return {"code": "PROBE_FAILED", "message": stderr.decode("utf-8", errors="ignore").strip()}
    payload = json.loads(stdout.decode("utf-8"))
    streams = payload.get("streams", [])
    if not isinstance(streams, list):
        return {"code": "PROBE_FAILED", "message": "ffprobe streams payload is invalid"}
    video = next((stream for stream in streams if is_stream(stream, "video")), None)
    audio = next((stream for stream in streams if is_stream(stream, "audio")), None)
    if video is None:
        return {"code": "VIDEO_TRACK_MISSING", "message": "Video track is required"}
    if audio is None:
        return {"code": "AUDIO_TRACK_MISSING", "message": "Audio track is required"}
    video_codec = str(video.get("codec_name", ""))
    audio_codec = str(audio.get("codec_name", ""))
    if video_codec != REQUIRED_VIDEO_CODEC:
        return {
            "code": "UNSUPPORTED_VIDEO_CODEC",
            "message": f"Video codec must be H.264, got {video_codec or 'unknown'}",
        }
    if audio_codec != REQUIRED_AUDIO_CODEC:
        return {
            "code": "UNSUPPORTED_AUDIO_CODEC",
            "message": f"Audio codec must be AAC, got {audio_codec or 'unknown'}",
        }
    LOGGER.info(
        "ingest_probe_succeeded",
        extra={"video_codec": video_codec, "audio_codec": audio_codec},
    )
    return None


def is_stream(value: object, codec_type: str) -> bool:
    return isinstance(value, dict) and value.get("codec_type") == codec_type


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    root = Path(os.environ.get("MLSP_ROOT", Path.cwd()))
    media_dir = Path(os.environ.get("MEDIA_DIR", root / "media" / "live"))
    cert_path = Path(os.environ.get("CERT_PATH", root / "certs" / "localhost.crt"))
    key_path = Path(os.environ.get("KEY_PATH", root / "certs" / "localhost.key"))
    cert_hash = ensure_localhost_cert(cert_path, key_path)

    metrics = Metrics()
    ring_buffer = SegmentRingBuffer(metrics=metrics)
    viewers = ViewerRegistry(metrics=metrics)
    init_path = media_dir / "init.mp4"
    init_segment = init_path.read_bytes() if init_path.exists() else None
    init_state = {"id": init_segment_id(init_segment, 0), "generation": "0"}
    service = WebTransportStreamService(
        ring_buffer=ring_buffer,
        viewers=viewers,
        init_segment=init_segment,
        init_segment_id=init_state["id"],
        metrics=metrics,
    )
    stream_state = {"state": "WAITING_FOR_INGEST"}
    ingest_state: dict[str, object] = {
        "protocol": "srt",
        "mode": "listener",
        "listenAddress": "0.0.0.0",
        "listenPort": 9000,
        "state": "LISTENING",
        "remoteAddress": None,
        "videoCodec": None,
        "audioCodec": None,
        "connectedAt": None,
        "lastError": None,
    }
    configuration = create_quic_configuration(cert_path, key_path)
    server: QuicServer = await serve(
        "127.0.0.1",
        4433,
        configuration=configuration,
        create_protocol=lambda quic, stream_handler=None: AioquicWebTransportProtocol(
            quic,
            stream_handler=stream_handler,
            stream_service=service,
        ),
    )
    api_server = await asyncio.start_server(
        lambda reader, writer: handle_api_stream(
            reader,
            writer,
            viewers=viewers,
            ring_buffer=ring_buffer,
            metrics=metrics,
            stream_service=service,
            stream_state=stream_state,
            ingest_state=ingest_state,
            init_state=init_state,
        ),
        "127.0.0.1",
        8000,
    )
    asyncio.create_task(
        watch_media(
            media_dir=media_dir,
            ring_buffer=ring_buffer,
            stream_service=service,
            stream_state=stream_state,
            ingest_state=ingest_state,
            init_state=init_state,
        )
    )
    print(f"WT_READY certHash={cert_hash}", flush=True)
    try:
        await asyncio.Future()
    finally:
        server.close()
        api_server.close()
        await api_server.wait_closed()


if __name__ == "__main__":
    asyncio.run(main())
