初回利用者が、このリポジトリを取得した直後からライブ配信の再生確認まで到達できるドキュメントを作成してください。

目的:

* プロジェクトを知らない利用者がREADMEだけを読んで起動できる
* Windows環境で実際に手順を再現できる
* ドキュメント上のコマンドとMakefile、scripts、実装が一致している
* 存在しない`make cert`のような手順を残さない

## 最初に確認すること

以下を実装側から確認してください。

1. Makefileに存在する全ターゲット
2. `make bootstrap`が実行する内容
3. 証明書生成スクリプトの実ファイル名と実行方法
4. `make run`が起動するプロセス
5. SRT Listenerの起動方法
6. SRT Callerの起動方法
7. ViewerのURL
8. HTTP APIのURL
9. WebTransport endpoint
10. Windowsで必要なツールとPATH設定
11. Dockerを使う箇所とローカル実行する箇所
12. 停止方法と残プロセスの確認方法
13. 初回起動時に生成されるファイルとディレクトリ
14. ECDSA P-256証明書の生成・利用方法
15. Chromiumの`serverCertificateHashes`利用により、OSへの証明書信頼登録が本当に必要か

ドキュメントを推測で書かず、実際のMakefile、scripts、package.json、pyproject.toml、compose.yamlを確認してください。

## 修正方針

README.mdを初回起動者向けの正本にしてください。

docs/OPERATIONS.mdは、詳細な運用・障害切り分け用にしてください。

READMEとOPERATIONSの役割:

```text
README.md
  初回セットアップ
  起動
  テスト配信
  ブラウザ視聴
  状態確認
  停止
  最小限のトラブルシューティング

docs/OPERATIONS.md
  詳細な起動構成
  プロセス構成
  ログ確認
  再起動
  SRT再接続
  不正入力
  障害切り分け
  後片付け
```

## README.mdに必須で含める内容

### 1. 対応環境

最低限、現在検証済みのWindows環境を書くこと。

例:

```text
Windows 10 / 11
PowerShell
GNU Make
Python 3.13
Node.js
npm
FFmpeg（libsrt対応）
ChromeまたはEdge
```

Dockerが必須か任意かを明記してください。

### 2. 必要ツールの確認

そのままコピーできる確認コマンドを書くこと。

```powershell
make --version
python --version
node --version
npm --version
ffmpeg -version
ffmpeg -protocols | Select-String srt
```

Dockerが必要なら以下も含める。

```powershell
docker --version
docker compose version
```

### 3. GNU MakeのPATH設定

現在の環境で必要な場合は、実際のパスを記載する。

```powershell
$env:Path = 'C:\Program Files (x86)\GnuWin32\bin;' + $env:Path
```

恒久設定が必要なら、その方法も分けて記載する。

### 4. 初回セットアップ

実在するターゲットだけを使用すること。

```powershell
make bootstrap
```

`bootstrap`が何を行うかを列挙する。

例:

```text
- Python依存関係の導入
- npm依存関係の導入
- 必要ディレクトリ作成
- 証明書生成
```

証明書生成がbootstrapに含まれない場合は、実在するスクリプトまたはターゲットを記載する。

Makefileに証明書生成ターゲットが必要なら、`cert`ターゲットを追加してからREADMEへ記載する。

### 5. 設定ファイル

`.env.example`から`.env`を作る必要がある場合は明記する。

```powershell
Copy-Item .env.example .env
```

変更が必要な値と、変更不要な値を説明する。

### 6. 起動

実際に動くコマンドを書くこと。

```powershell
make run
```

起動されるプロセスを記載する。

```text
- Python aioquic HTTP/3 / WebTransport server
- FastAPI管理API
- Vite Viewer
- FFmpeg SRT Listener / segmenter
```

`make run`がこれらすべてを起動しない場合は、正しい複数ターミナル手順を書く。

### 7. 正常起動の確認

確認コマンドと期待値を記載する。

```powershell
curl.exe -k https://localhost:4433/api/health
curl.exe -k https://localhost:4433/api/ingest
curl.exe -k https://localhost:4433/api/stream
```

期待状態:

```text
health.status = ok
ingest.state = LISTENING
stream.state = WAITING_FOR_INGEST または同等状態
```

実装上の正しい状態名に合わせること。

### 8. テスト配信開始

実在するターゲットを記載する。

```powershell
make stream-start
```

起動する入力を説明する。

```text
FFmpeg lavfi
→ H.264/AAC
→ MPEG-TS
→ SRT Caller
→ localhost:9000
```

### 9. ブラウザで視聴

実際のURLを記載する。

```text
https://localhost:5173
```

確認項目:

```text
- Connection: CONNECTED
- Player: PLAYING
- sequenceが増加
- video.currentTimeが増加
- 映像と音声が再生される
```

証明書警告や自動再生制限がある場合は、実際の挙動に合わせて手順を書く。

### 10. 配信停止・全体停止

実在するコマンドを書く。

```powershell
make stream-stop
make stop
```

`make stop`が存在しない場合は、実装に合う停止方法を書くか、必要ならターゲットを追加する。

### 11. 後片付け

```powershell
make clean
```

何が削除されるかを書く。

残プロセス確認方法も含める。

### 12. 最小トラブルシューティング

少なくとも次を含める。

* `make: ターゲットがありません`
* FFmpegがSRT非対応
* UDP 9000が使用中
* UDP 4433が使用中
* ViewerがCONNECTINGのまま
* ingestがLISTENINGから変わらない
* 映像が再生されない
* 残ったnode/python/ffmpegプロセスの停止

## docs/OPERATIONS.mdの修正

以下を実装に合わせて更新してください。

* 存在しない`make cert`を削除または実装
* 起動プロセスの正確な構成
* Windowsでの手順
* 証明書の扱い
* SRT Caller / Listenerの起動順
* APIの期待状態
* stream end後の再起動方法
* 残プロセスの停止方法
* `make clean`の説明
* 実装済みE2E結果

READMEと矛盾しないことを確認してください。

## Makefileの改善

利用者向けに次のターゲットが存在するか確認してください。

```text
help
bootstrap
run
stream-start
stream-stop
stop
clean
lint
test
build
e2e
```

不足していて、既存scriptsで安全に実装できるものは追加してください。

`make help`では、各ターゲットの説明を表示してください。

例:

```text
bootstrap     Install dependencies and prepare local environment
run           Start server, viewer, and SRT listener
stream-start  Start FFmpeg test encoder
stream-stop   Stop FFmpeg test encoder
stop          Stop all project processes
clean         Remove generated media and test artifacts
```

## 実行検証

ドキュメントを書くだけで終わらせず、クリーンな状態を想定して手順を順番に実行してください。

最低限、以下を確認すること。

```powershell
make help
make bootstrap
make run
make stream-start
```

その後:

```text
- /api/healthが成功
- /api/ingestがCONNECTED
- /api/streamがLIVE
- ChromiumでPLAYING
- video.currentTimeが増加
```

終了確認:

```powershell
make stream-stop
make stop
make clean
```

確認:

```text
- node/python/ffmpegの関連プロセスが残らない
- UDP 9000と4433が解放される
- git statusに生成物が出ない
```

既存の開発環境を破壊しない範囲で検証してください。

## 完了条件

* 初回利用者がREADMEだけで起動できる
* READMEに存在しないコマンドがない
* MakefileとREADMEが一致する
* OPERATIONSとREADMEが矛盾しない
* Windows PowerShellでコピー実行できる
* 起動からブラウザ再生まで実確認済み
* 停止・後片付けまで実確認済み
* lint、test、build、e2eが引き続きPASS
* E2Eは8 passed / 0 skippedを維持
* リモートリポジトリへpushしない

## 完了報告

以下を報告してください。

* Makefileへ追加・変更したターゲット
* READMEへ記載した初回起動手順
* OPERATIONSの修正内容
* 実際に実行したコマンド
* 起動確認結果
* ブラウザ再生確認結果
* 停止・後片付け確認結果
* lint / test / build / e2e結果
* git status確認結果
* 未解決事項

```

この作業は「ドキュメント修正」ではなく、**初回起動手順の受入試験**として扱うのが適切です。今回の`make cert`不一致も、この受入試験で検出すべき問題です。
```
