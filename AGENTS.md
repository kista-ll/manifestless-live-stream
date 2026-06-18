# AGENTS.md

## 目的

このリポジトリは、マニフェストレスなセグメント型ライブ配信の技術実験である。商用品質の配信基盤を作らない。

## 必須ルール

1. 作業開始時に`docs/REQUIREMENTS.md`、`docs/CODEX_RULES.md`、`docs/DECISIONS.md`を読む。
2. `docs/REQUIREMENTS.md` の受入条件を優先する。
3. `docs/TASKS.md` のフェーズ順に実装する。
4. スコープ外機能を追加しない。
5. 公開インターフェースを変更した場合は、同じ変更内で該当ドキュメントとテストを更新する。
6. WebTransport制御メッセージは `docs/PROTOCOL.md` に従う。
7. バイナリ形式は独自に拡張せず、指定されたフレーム形式を使う。
8. メディア生成はFFmpegへ委譲し、独自エンコーダを実装しない。
9. ブラウザの自動テストでWebTransportが利用できない場合、単体テストを代替にせず、E2E未実施として明示する。
10. 失敗を握りつぶさない。サーバ、セグメンター、プレイヤーの状態とエラーをログへ出す。
11. 仕様に矛盾がある場合は推測で実装せず、`docs/DECISIONS.md` に論点を追記する。

## 推奨ディレクトリ構成

```text
.
├── AGENTS.md
├── README.md
├── compose.yaml
├── Makefile
├── apps
│   ├── server
│   │   ├── pyproject.toml
│   │   ├── src
│   │   └── tests
│   └── viewer
│       ├── package.json
│       ├── src
│       └── tests
├── scripts
│   ├── generate-cert.sh
│   ├── start-test-stream.sh
│   └── verify-segments.sh
├── media
│   └── live
└── docs
```

## 固定技術

- Python 3.13
- aioquic
- FastAPI
- uvicorn
- TypeScript
- Vite
- Vitest
- Playwright
- FFmpeg
- Docker Compose
- pytest
- Ruff
- mypy

依存ライブラリの変更は可能だが、WebTransportサーバをWebSocketへ置き換えてはならない。


## Git管理ルール

以下はcommit・pushしないこと。

- 秘密鍵、証明書、パスフレーズ
- `.env`およびローカル設定
- FFmpeg生成物
- ログ、テスト結果、coverage、Playwrightレポート
- PythonおよびNode.jsの依存物・キャッシュ
- 一時ファイル

公開設定は`.env.example`、生成ディレクトリは`.gitkeep`だけを管理する。

commit前に実行する。

```bash
git status --short
git status --ignored
```

## ユーザー指摘のルール化

今後も適用する指摘は`docs/FEEDBACK_WORKFLOW.md`に従う。

- 実装ルールは`docs/CODEX_RULES.md`
- 設計判断は`docs/DECISIONS.md`
- 単発修正はルール化しない
- 追加時は検証方法を必ず記載する
- 完了報告にルールIDを含める

## 品質ゲート

完了前に以下をすべて成功させる。

```bash
make lint
make test
make build
make e2e
```

`make e2e`はChrome系ブラウザで実行する。

## 実装上の禁止事項

- HLS/DASHマニフェストを生成しない
- WebRTCを使わない
- セグメント一覧を定期ポーリングしない
- 映像・音声の再エンコードをサーバ内で行わない
- Redis、Kafka、DBを導入しない
- Kubernetes対応を追加しない
- ユーザー管理や認証を追加しない
- 複数品質、複数配信、録画を追加しない
