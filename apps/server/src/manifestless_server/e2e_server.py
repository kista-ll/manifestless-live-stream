from __future__ import annotations

import asyncio
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


async def watch_media(
    *,
    media_dir: Path,
    ring_buffer: SegmentRingBuffer,
    stream_service: WebTransportStreamService,
) -> None:
    watcher = SegmentWatcher(media_dir=media_dir, ring_buffer=ring_buffer)
    last_init_mtime: float | None = None
    while True:
        init_path = media_dir / "init.mp4"
        if init_path.exists():
            mtime = init_path.stat().st_mtime
            if last_init_mtime != mtime:
                stream_service.update_init_segment(init_path.read_bytes())
                last_init_mtime = mtime
        for segment in watcher.scan_once():
            await stream_service.push_segment(segment)
        await asyncio.sleep(0.2)


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
    service = WebTransportStreamService(
        ring_buffer=ring_buffer,
        viewers=viewers,
        init_segment=init_segment,
        metrics=metrics,
    )
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
    asyncio.create_task(
        watch_media(media_dir=media_dir, ring_buffer=ring_buffer, stream_service=service)
    )
    print(f"WT_READY certHash={cert_hash}", flush=True)
    try:
        await asyncio.Future()
    finally:
        server.close()


if __name__ == "__main__":
    asyncio.run(main())
