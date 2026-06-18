# 実装タスク

タスクは上から順に実施する。各フェーズの完了条件を満たすまで次へ進まない。

## Phase 0: リポジトリ初期化

- [ ] 推奨ディレクトリ構成を作る
- [ ] Pythonプロジェクトを作る
- [ ] Vite + TypeScript viewerを作る
- [ ] Docker Composeを作る
- [ ] Makefileを作る
- [ ] Ruff、mypy、pytest、ESLint、Vitest、Playwrightを設定する
- [ ] `.gitignore`を作成する
- [ ] `.env.example`を作成する
- [ ] `media/live/.gitkeep`を作成する
- [ ] `docs/CODEX_RULES.md`を作成する
- [ ] `docs/FEEDBACK_WORKFLOW.md`を作成する
- [ ] 秘密鍵・証明書・生成メディア・`.env`がGit管理対象外であることを検証する
- [ ] 自己署名証明書生成scriptを作る
- [ ] CI相当のローカルコマンドを作る

完了条件:

```bash
make lint
make test
make build
```

が空実装でも成功する。

## Phase 1: SRT ingest・メディア生成

- [ ] FFmpegがSRT対応ビルドであることを検証する
- [ ] SRT Caller用テスト映像scriptを作る
- [ ] SRT Listener + segmenter scriptを作る
- [ ] Encoder Caller / Server Listener構成を実装する
- [ ] MPEG-TSでH.264/AACを受信する
- [ ] init.mp4を生成する
- [ ] 1秒`.m4s`を連続生成する
- [ ] stream copy可能条件を検証する
- [ ] 条件不一致時の再エンコード設定を実装する
- [ ] 完成ファイル判定を実装する
- [ ] ffprobe検証scriptを作る
- [ ] ファイル名・コーデック・GOP・時間を検証するテストを作る
- [ ] Caller切断・再接続を検証する

完了条件:

- SRT CallerからListenerへ接続できる
- 接続後10秒以内にsegment生成が始まる
- 60秒連続でsegmentが生成される
- sequenceが連続する
- Caller再接続後に新しいinit segmentが生成される
- ffprobe検証が成功する

## Phase 2: Server domain

- [ ] StreamStateを実装する
- [ ] Segmentモデルを実装する
- [ ] 30件RingBufferを実装する
- [ ] SegmentWatcherを実装する
- [ ] sequence欠落検出を実装する
- [ ] ViewerRegistryを実装する
- [ ] viewer上限10を実装する
- [ ] ingest stateを実装する
- [ ] FFmpeg子プロセス管理を実装する
- [ ] ingest切断時のINTERRUPTED遷移を実装する
- [ ] ingest再接続時のring buffer resetを実装する
- [ ] metricsを実装する
- [ ] 単体テストを作る

完了条件:

```bash
pytest
```

が成功し、RingBufferとviewer制限がテストされている。

## Phase 3: Protocol

- [ ] control message型を定義する
- [ ] NDJSON encoder/decoderを実装する
- [ ] binary frame encoderを実装する
- [ ] header境界値テストを作る
- [ ] protocol versionチェックを実装する
- [ ] application close codeを実装する

完了条件:

- PROTOCOL.mdの全messageがテストされている
- encode/decode round-tripが成功する

## Phase 4: WebTransport server

- [ ] aioquicでHTTP/3 serverを起動する
- [ ] WebTransport endpointを実装する
- [ ] client_helloを受信する
- [ ] capacity checkを実装する
- [ ] stream_initを送る
- [ ] init segmentを送る
- [ ] startSequenceから保持segmentを送る
- [ ] live segmentをPushする
- [ ] viewerごとの送信queueを実装する
- [ ] slow consumer処理を実装する
- [ ] stream endを実装する
- [ ] session logを実装する

完了条件:

- Pythonのテストclientまたはブラウザでinit + 5 media segmentを受信できる
- 11番目が拒否される

## Phase 5: HTTP API

- [ ] `/api/health`
- [ ] `/api/stream`
- [ ] `/api/stream/end`
- [ ] `/api/stream/reset`
- [ ] `/api/metrics`
- [ ] `/api/ingest`
- [ ] APIテスト

完了条件:

- API.mdのresponse contractテストが成功する

## Phase 6: Viewer transport

- [ ] TransportClientを実装する
- [ ] control streamを読み取る
- [ ] incoming unidirectional streamsを読む
- [ ] ProtocolDecoderを実装する
- [ ] SegmentReorderBufferを実装する
- [ ] AbortControllerによるsession破棄を実装する
- [ ] retry backoffを実装する
- [ ] Vitestを作る

完了条件:

- 順不同・欠落・再接続の単体テストが成功する

## Phase 7: MSE player

- [ ] MseControllerを実装する
- [ ] MIME type supportチェックを実装する
- [ ] init appendを実装する
- [ ] media append queueを実装する
- [ ] buffer removeを実装する
- [ ] LatencyControllerを実装する
- [ ] state machineを実装する
- [ ] autoplay拒否UIを実装する
- [ ] debug panelを実装する
- [ ] Vitestを作る

完了条件:

- mock SourceBufferでqueueとlatency制御がテストされている

## Phase 8: E2E

- [ ] Chromium起動optionを設定する
- [ ] 自己署名証明書をテスト環境で扱う
- [ ] E2E-001〜008を実装する
- [ ] 10 viewer試験を実装する
- [ ] テスト結果を保存する

完了条件:

```bash
make e2e
```

が成功する。

## Phase 9: ドキュメント・最終確認

- [ ] READMEの起動手順を実環境で再実行する
- [ ] API、Protocol、Mediaの実装差分を反映する
- [ ] 既知の制限を書く
- [ ] `docs/TEST_RESULTS.md`を作る
- [ ] AC-001〜011の結果を記録する
- [ ] スコープ外実装が入っていないか確認する

完了条件:

```bash
make clean
make bootstrap
make run
make e2e
```

が新規環境で成功する。
