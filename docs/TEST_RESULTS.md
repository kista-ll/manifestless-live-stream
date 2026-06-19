# テスト結果

最終更新: 2026-06-20

## コマンド結果

| コマンド | 結果 | 備考 |
|---|---:|---|
| `make lint` | PASS | Ruff、mypy、ESLint成功 |
| `make test` | PASS | pytest 27件、Vitest 15件、Phase 1 SRT smoke成功 |
| `make build` | PASS | Python compile、Vite build、segment ffprobe検証成功 |
| `make e2e` | PASS | 実ChromiumでE2E-001〜E2E-008がPASS。8 passed / 0 skipped |

## 初回起動手順検証

2026-06-20にREADMEのPowerShell手順で次を確認した。

| 項目 | 結果 | 記録 |
|---|---|---|
| `make help` | PASS | 利用者向けターゲット一覧を表示。 |
| `make bootstrap` | PASS | Python editable install、`npm ci`、ECDSA P-256 localhost証明書生成が成功。 |
| `make run` | PASS | WebTransport/API server、Vite Viewer、FFmpeg SRT Listenerが起動。 |
| 起動直後API | PASS | `/api/health={"status":"ok"}`、`ingest.state=LISTENING`、`stream.state=WAITING_FOR_INGEST`。 |
| `make stream-start` | PASS | SRT Caller開始後、`ingest.state=CONNECTED`、`stream.state=LIVE`、segment生成を確認。 |
| ブラウザ視聴 | PASS | Headless Chromeで`Connection=CONNECTED`、`Player=PLAYING`、`sequence=000049`、遅延2.571秒、`video.currentTime`が43.509秒から46.477秒へ増加。 |
| 停止・後片付け | PASS | `make stream-stop`、`make stop`、`make clean`後、関連node/python/ffmpegプロセスとUDP 9000/4433が残らないことを確認。 |

## 受入条件 AC-001〜AC-011

| ID | 結果 | 記録 |
|---|---|---|
| AC-001 基本再生 | PASS | E2E-001でFFmpeg SRT Caller→FFmpeg SRT Listener/segmenter→Python WebTransport over HTTP/3→Chromium→MSE→video.currentTime増加を確認。 |
| AC-002 途中参加 | PASS | E2E-002で配信開始30秒以上後に接続し、`oldestSequence=5`、`latestSequence=34`、`startSequence=32`、最初のmedia sequence `32`を確認。30秒後のライブ遅延は2.559秒。 |
| AC-003 10視聴 | PASS | E2E-003で10個の独立BrowserContextが同一配信へ接続し、全viewerのWebTransport確立、PLAYING、`video.currentTime`増加、`viewerCount=10`、30秒以上の継続再生を確認。 |
| AC-004 11人目拒否 | PASS | E2E-004で10個の独立BrowserContextがPLAYINGになり、11人目が`capacity_exceeded`/`limit=10`とapplication close code `0x101`を受信することを確認。`viewerCount`は拒否前、拒否直後、10秒後すべて10。`viewerRejectedTotal`は0→1。既存10 viewerは拒否後もPLAYINGで`video.currentTime`増加を確認。 |
| AC-005 再接続 | PASS | E2E-007でSRT Caller停止後にingest/stream stateが`INTERRUPTED`へ遷移し、同一Pageのviewerが`discontinuity`を受信、新しいMediaSourceを生成して30秒以内にPLAYINGへ復帰することを確認。 |
| AC-006 遅延追従 | PASS | E2E-005で実Chromiumのvideoをpause/playし、3〜5秒遅延帯の`playbackRate=1.05`、10秒pause後のseek、再開から1.367秒でライブ遅延2.549秒への収束、最終`PLAYING`/`playbackRate=1.0`を確認。 |
| AC-007 配信終了 | PASS | E2E-006で`POST /api/stream/end`後に`stream_ended(lastSequence=6)`を受信し、append queue 0、SourceBuffer非更新、`endOfStream()`、MediaSource `ended`、Player `ENDED`、15秒間再接続なし、`viewerCount=0`、stream state `ENDED`を確認。 |
| AC-008 マニフェスト不使用 | PASS | E2E-001〜008の実ブラウザ経路はWebTransport pushとMSEで再生し、viewer/serverは`internal.m3u8`や`.mpd`を視聴制御に使用しないことを確認。 |
| AC-009 SRT ingest | PASS | `make test`のPhase 1 smokeでSRT Caller→Listener、10秒以内の`init.mp4`/`.m4s`生成を確認。 |
| AC-010 SRT再接続 | PASS | E2E-007で再接続前`initSegmentId=1-1358-6f2510d0dbb2fcf3`、再接続後`initSegmentId=3-1358-6f2510d0dbb2fcf3`を確認。content hashが同じでもgenerationが増え、ring bufferは`oldestSequence=1`へリセット。PLAYING復帰は7.341秒、最終ライブ遅延は5秒以内。 |
| AC-011 不正入力 | PASS | E2E-008でvideo trackなし、audio trackなし、video codec MPEG-2、audio codec MP2を実SRT/MPEG-TS入力として送信し、`VIDEO_TRACK_MISSING`、`AUDIO_TRACK_MISSING`、`UNSUPPORTED_VIDEO_CODEC`、`UNSUPPORTED_AUDIO_CODEC`を検出。各ケースでstream/ingest state `ERROR`、segment非公開、Viewer非PLAYING、正常入力への復旧を確認。 |

## 未解決事項

- なし。Phase 8のE2Eは8 passed / 0 skipped。
