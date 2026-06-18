# テスト結果

最終更新: 2026-06-18

## コマンド結果

| コマンド | 結果 | 備考 |
|---|---:|---|
| `make lint` | PASS | Ruff、mypy、ESLint成功 |
| `make test` | PASS | pytest 26件、Vitest 14件、Phase 1 SRT smoke成功 |
| `make build` | PASS | Python compile、Vite build、segment ffprobe検証成功 |
| `npm --prefix apps/viewer run e2e` | PASS / SKIPPED | E2E-001は実ChromiumでPASS。E2E-002〜008は未有効化のためskip |

## 受入条件 AC-001〜AC-011

| ID | 結果 | 記録 |
|---|---|---|
| AC-001 基本再生 | PASS | E2E-001でFFmpeg SRT Caller→FFmpeg SRT Listener/segmenter→Python WebTransport over HTTP/3→Chromium→MSE→video.currentTime増加を確認。 |
| AC-002 途中参加 | PARTIAL | RingBufferの`latest - 2`開始はpytestで確認。ブラウザ途中参加E2Eは未実施。 |
| AC-003 10視聴 | PARTIAL | ViewerRegistryの10接続上限はpytestで確認。10ブラウザPLAYINGは未実施。 |
| AC-004 11人目拒否 | PARTIAL | WebTransport serviceの11人目`capacity_exceeded`はpytestで確認。既存10ブラウザ継続は未実施。 |
| AC-005 再接続 | NOT RUN | ブラウザ自動再接続E2Eは未実施。 |
| AC-006 遅延追従 | PARTIAL | LatencyControllerのseek/playbackRate制御はVitestで確認。ブラウザpause復帰E2Eは未実施。 |
| AC-007 配信終了 | PARTIAL | WebTransport serviceの`stream_ended`送信とPlayerStateMachineの再接続抑止はテスト済み。ブラウザE2Eは未実施。 |
| AC-008 マニフェスト不使用 | PARTIAL | viewer/serverは`internal.m3u8`を参照しない実装。DevTools通信確認は未実施。 |
| AC-009 SRT ingest | PASS | `make test`のPhase 1 smokeでSRT Caller→Listener、10秒以内の`init.mp4`/`.m4s`生成を確認。 |
| AC-010 SRT再接続 | PARTIAL | `scripts/phase1-reconnect.mjs`で再接続相当の新規`init.mp4`生成を確認。viewer復帰E2Eは未実施。 |
| AC-011 不正入力 | NOT RUN | invalid ingest検出とERROR/INTERRUPTED遷移は未実装。E2E-008はskip。 |

## 未解決事項

- aioquicの実ブラウザWebTransport endpointは起動骨格のみで、control streamとunidirectional media streamの実QUIC送受信は未完了。
- E2EはPlaywright上にケースを列挙したが、WebTransportブラウザ経路未結線のため全件skip。
- 不正入力のffprobe/FFmpeg stderr解析とstream state遷移は未実装。
