# HTTP管理API

## 1. 基本

Base URL:

```text
https://localhost:4433/api
```

JSONのみ。認証なし。

## 2. GET /health

Response `200`:

```json
{
  "status": "ok"
}
```

## 3. GET /stream

Response `200`:

```json
{
  "streamId": "live-001",
  "state": "LIVE",
  "viewerCount": 3,
  "viewerLimit": 10,
  "initAvailable": true,
  "oldestSequence": 93,
  "latestSequence": 122,
  "segmentCount": 30,
  "ingest": {
    "protocol": "srt",
    "state": "CONNECTED",
    "remoteAddress": "192.0.2.10:54321"
  }
}
```

## 4. POST /stream/end

配信終了を明示する。

Response `202`:

```json
{
  "accepted": true
}
```

副作用:

1. stateをENDINGへ変更
2. 全viewerへ`stream_ended`
3. viewer sessionをnormal close
4. stateをENDEDへ変更

## 5. POST /stream/reset

開発用。viewerを切断し、リングバッファと状態を初期化する。

Response `202`:

```json
{
  "accepted": true
}
```

本番機能ではない。

## 6. GET /metrics

Prometheus形式ではなく、実験確認用JSONとする。

```json
{
  "segmentsRegisteredTotal": 120,
  "segmentsDroppedTotal": 0,
  "viewerConnectionsTotal": 4,
  "viewerRejectedTotal": 0,
  "viewerDisconnectsTotal": 1,
  "bytesSentTotal": 33821920
}
```


## 7. GET /ingest

Response `200`:

```json
{
  "protocol": "srt",
  "mode": "listener",
  "listenAddress": "0.0.0.0",
  "listenPort": 9000,
  "state": "CONNECTED",
  "remoteAddress": "192.0.2.10:54321",
  "videoCodec": "h264",
  "audioCodec": "aac",
  "connectedAt": "2026-06-17T12:00:00Z",
  "lastError": null
}
```

`state`:

```text
STOPPED
LISTENING
CONNECTED
INTERRUPTED
ERROR
```
