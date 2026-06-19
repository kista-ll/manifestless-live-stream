# テスト結果

最終更新: 2026-06-19

## コマンド結果

| コマンド | 結果 | 備考 |
|---|---:|---|
| `make lint` | PASS | Ruff、mypy、ESLint成功 |
| `make test` | PASS | pytest 26件、Vitest 14件、Phase 1 SRT smoke成功 |
| `make build` | PASS | Python compile、Vite build、segment ffprobe検証成功 |
| `make e2e` | PASS / SKIPPED | E2E-001〜E2E-004は実ChromiumでPASS。E2E-005〜E2E-008は未有効化のためskip |

## 受入条件 AC-001〜AC-011

| ID | 結果 | 記録 |
|---|---|---|
| AC-001 基本再生 | PASS | E2E-001でFFmpeg SRT Caller→FFmpeg SRT Listener/segmenter→Python WebTransport over HTTP/3→Chromium→MSE→video.currentTime増加を確認。 |
| AC-002 途中参加 | PASS | E2E-002で配信開始30秒以上後に接続し、`oldestSequence=6`、`latestSequence=35`、`startSequence=33`、最初のmedia sequence `33`を確認。30秒後のライブ遅延は2.562秒。 |
| AC-003 10視聴 | PASS | E2E-003で10個の独立BrowserContextが同一配信へ接続し、全viewerのWebTransport確立、PLAYING、`video.currentTime`増加、`viewerCount=10`、30秒以上の継続再生を確認。 |
| AC-004 11人目拒否 | PASS | E2E-004で10個の独立BrowserContextがPLAYINGになり、11人目が`capacity_exceeded`/`limit=10`とapplication close code `0x101`を受信することを確認。`viewerCount`は拒否前、拒否直後、10秒後すべて10。`viewerRejectedTotal`は0→1。既存10 viewerは拒否後もPLAYINGで`video.currentTime`増加を確認。 |
| AC-005 再接続 | NOT RUN | ブラウザ自動再接続E2Eは未実施。 |
| AC-006 遅延追従 | PARTIAL | LatencyControllerのseek/playbackRate制御はVitestで確認。ブラウザpause復帰E2Eは未実施。 |
| AC-007 配信終了 | PARTIAL | WebTransport serviceの`stream_ended`送信とPlayerStateMachineの再接続抑止はテスト済み。ブラウザE2Eは未実施。 |
| AC-008 マニフェスト不使用 | PARTIAL | viewer/serverは`internal.m3u8`を参照しない実装。DevTools通信確認は未実施。 |
| AC-009 SRT ingest | PASS | `make test`のPhase 1 smokeでSRT Caller→Listener、10秒以内の`init.mp4`/`.m4s`生成を確認。 |
| AC-010 SRT再接続 | PARTIAL | `scripts/phase1-reconnect.mjs`で再接続相当の新規`init.mp4`生成を確認。viewer復帰E2Eは未実施。 |
| AC-011 不正入力 | NOT RUN | invalid ingest検出とERROR/INTERRUPTED遷移は未実装。E2E-008はskip。 |

## 未解決事項

- E2E-005〜E2E-008は未有効化のためskip。
- 不正入力のffprobe/FFmpeg stderr解析とstream state遷移は未実装。
