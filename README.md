# Manifestless Live Streaming Experiment

WebRTCやHLS/DASHマニフェストを使わず、CMAF/fMP4セグメントをWebTransportでPushし、ブラウザのMedia Source Extensions（MSE）で再生する実験システム。

## 実験目的

次の仮説を検証する。

> マニフェストファイルを使わなくても、接続時メタデータ、初期化セグメント、連番付きメディアセグメントをサーバからPushすれば、ブラウザで途中参加可能なライブ再生を構成できる。

## スコープ

- 同時配信: 1
- 同時視聴: 最大10
- 映像: H.264
- 音声: AAC
- コンテナ: CMAF互換 fragmented MP4
- セグメント長: 1秒
- GOP: 1秒
- 品質: 1280×720 / 30fps / 映像2Mbps / 音声128kbps
- 配信経路: WebTransport over HTTP/3
- プレイヤー: ブラウザ + MSE
- マニフェスト: なし
- 認証、課金、DRM、CDN、録画、ABR: なし

## 想定構成

```text
配信入力
  ↓
FFmpeg
  ↓ init.mp4 + 1秒ごとの .m4s
Segment Watcher / Ring Buffer
  ↓
WebTransport Server
  ↓
Viewer (TypeScript + MSE)
```

初期実装ではFFmpegのテスト映像を入力に使用する。実カメラ・OBS入力は受入試験完了後に追加する。

## Codexへの開始指示

```text
このリポジトリの AGENTS.md と docs/ を読み、docs/TASKS.md の順序で実装してください。
各フェーズ終了時にテストを実行し、完了条件を満たしてから次へ進んでください。
仕様に矛盾がある場合は、実装を進めず docs/DECISIONS.md に論点と推奨案を追記してください。
スコープ外機能は追加しないでください。
```

## ドキュメント

- `.gitignore`: commit・pushしないファイル
- `.env.example`: 公開可能な環境変数例
- `AGENTS.md`: Codex向け作業ルール
- `docs/REQUIREMENTS.md`: 要求仕様
- `docs/ARCHITECTURE.md`: 構成・責務
- `docs/PROTOCOL.md`: WebTransportアプリケーションプロトコル
- `docs/MEDIA.md`: FFmpeg・fMP4仕様
- `docs/PLAYER.md`: MSEプレイヤー仕様
- `docs/API.md`: HTTP API仕様
- `docs/TEST_PLAN.md`: 試験計画
- `docs/TASKS.md`: 実装タスク
- `docs/OPERATIONS.md`: 起動・確認・障害切り分け
- `docs/DECISIONS.md`: 設計判断
- `docs/CODEX_RULES.md`: 指摘から追加された恒久ルール
- `docs/FEEDBACK_WORKFLOW.md`: 指摘をルール化する手順

## 現在の検証コマンド

Windows環境ではGNU MakeをPATHに追加してから実行する。

```powershell
$env:Path = 'C:\Program Files (x86)\GnuWin32\bin;' + $env:Path
make lint
make test
make build
make e2e
```

`make e2e`はE2E-001〜008を列挙するが、現時点では実ブラウザWebTransport再生経路が未結線のためskipする。結果は`docs/TEST_RESULTS.md`へ記録する。
