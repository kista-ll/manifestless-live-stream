# Manifestless Live Streaming Experiment

WebRTCやHLS/DASHマニフェストを使わず、CMAF/fMP4セグメントをWebTransportでPushし、ブラウザのMedia Source Extensionsで再生する実験システムです。商用品質の配信基盤ではなく、ローカルで技術検証するためのリポジトリです。

## 対応環境

検証済み環境:

- Windows 11
- PowerShell
- GNU Make: `C:\Program Files (x86)\GnuWin32\bin\make.exe`
- Python 3.13
- Node.js / npm
- FFmpeg 8.0.1 full build, libsrt対応
- Google Chrome

Docker Compose設定はありますが、初回起動手順では使いません。サーバ、Viewer、FFmpegはローカルプロセスとして起動します。

## 必要ツールの確認

PowerShellで確認します。`make` が見つからない場合は、先にPATHを追加してください。

```powershell
$env:Path = 'C:\Program Files (x86)\GnuWin32\bin;' + $env:Path
make --version
python --version
node --version
npm --version
ffmpeg -version
ffmpeg -protocols | Select-String srt
```

この環境のようにPython 3.13を明示する場合は、各コマンドの前に指定できます。

```powershell
$env:Path = 'C:\Program Files (x86)\GnuWin32\bin;' + $env:Path
make PYTHON='C:/Users/y-aka/AppData/Local/Programs/Python/Python313/python.exe' help
```

PATHを恒久設定する場合:

```powershell
[Environment]::SetEnvironmentVariable(
  'Path',
  'C:\Program Files (x86)\GnuWin32\bin;' + [Environment]::GetEnvironmentVariable('Path', 'User'),
  'User'
)
```

恒久設定をしていない場合、この`$env:Path = ...`はPowerShellを開くたびに必要です。`make run`用と`make stream-start`用でPowerShellを2つ開く場合は、両方のPowerShellで実行してください。

## 初回セットアップ

```powershell
make bootstrap
```

`bootstrap` は次を行います。

- リポジトリの必須ファイル確認
- Python serverのeditable installとdev依存導入
- Viewerの`npm ci`
- `certs/localhost.crt`と`certs/localhost.key`の生成

証明書はECDSA P-256自己署名証明書です。ViewerはChromiumの`serverCertificateHashes`へ証明書ハッシュを渡すため、`make run`が表示するURLを使う限り、OSへの証明書信頼登録は不要です。

`.env`の作成はローカルMake手順では不要です。`.env.example`はDocker Compose向けの公開可能な設定例です。

## 起動

PowerShell 1つ目:

```powershell
make run
```

起動されるプロセス:

- Python aioquic WebTransport server: UDP `127.0.0.1:4433`
- HTTP管理API: TCP `127.0.0.1:8000`
- Vite Viewer: `http://127.0.0.1:5173`
- FFmpeg SRT Listener / segmenter: UDP `0.0.0.0:9000`

`make run`の出力に、`certHash`付きのViewer URLが表示されます。ブラウザ視聴ではそのURLを使ってください。

## 正常起動の確認

別のPowerShellで確認します。

```powershell
curl.exe -s http://127.0.0.1:8000/api/health
curl.exe -s http://127.0.0.1:8000/api/ingest
curl.exe -s http://127.0.0.1:8000/api/stream
```

期待値:

- `health.status = ok`
- `ingest.state = LISTENING`
- `stream.state = WAITING_FOR_INGEST`

## テスト配信開始

PowerShell 2つ目:

```powershell
$env:Path = 'C:\Program Files (x86)\GnuWin32\bin;' + $env:Path
make stream-start
```

このコマンドはFFmpeg lavfiのテスト映像と音声を、H.264/AACのMPEG-TSとしてSRT Callerで送信します。

```text
FFmpeg lavfi
-> H.264/AAC
-> MPEG-TS
-> SRT Caller
-> srt://127.0.0.1:9000?mode=caller&latency=200000
```

配信開始後の期待値:

```powershell
curl.exe -s http://127.0.0.1:8000/api/ingest
curl.exe -s http://127.0.0.1:8000/api/stream
```

- `ingest.state = CONNECTED`
- `stream.state = LIVE`
- `latestSequence`が増加する

## ブラウザで視聴

通常起動のChromeではWebTransport開発用フラグが効かず、`ERR_QUIC_PROTOCOL_ERROR.QUIC_NETWORK_IDLE_TIMEOUT`になることがあります。次のコマンドで、専用プロファイルのChromeまたはEdgeをWebTransport用フラグ付きで開きます。

```powershell
$env:Path = 'C:\Program Files (x86)\GnuWin32\bin;' + $env:Path
make browser-open
```

手動で開く場合は、`make run`が表示したViewer URLをChromeで開きます。

```text
http://127.0.0.1:5173/?wt=...&certHash=...
```

確認項目:

- `Connection: CONNECTED`
- `Player: PLAYING`
- `Sequence`が増加
- `Latency`が表示される
- 映像と音声が再生される

ブラウザの自動再生制限で音声が聞こえない場合は、動画コントロールでミュート解除または再生操作をしてください。`certHash`なしのURLで開くとWebTransport接続に失敗することがあります。

## 配信停止・全体停止

PowerShell 2つ目のテスト配信を止める:

```powershell
make stream-stop
```

すべてのローカルプロセスを止める:

```powershell
make stop
```

`make run`を表示しているPowerShellでは、`Ctrl+C`でも停止できます。

## 後片付け

```powershell
make clean
```

削除されるもの:

- `media/live`配下の生成済み`init.mp4`、`.m4s`、`internal.m3u8`
- `certs`
- `tmp`
- Python/Nodeのテスト・ビルド・キャッシュ生成物
- Playwrightレポートとテスト結果

残プロセス確認:

```powershell
Get-Process node,python,ffmpeg -ErrorAction SilentlyContinue
Get-NetUDPEndpoint -LocalPort 9000,4433 -ErrorAction SilentlyContinue
```

## 最小トラブルシューティング

`make: The term 'make' is not recognized`
: GNU MakeをPATHに追加してください。`$env:Path = 'C:\Program Files (x86)\GnuWin32\bin;' + $env:Path`
  PowerShellごとの一時設定なので、新しいPowerShellを開いた場合は再度実行してください。恒久設定後はPowerShellを開き直してください。

`Access is denied`でPythonが起動しない
: 実行できるPython 3.13を指定してください。例: `make PYTHON='C:/path/to/python.exe' bootstrap`

FFmpegがSRT非対応
: `ffmpeg -protocols | Select-String srt`で`srt`が出るFFmpegをPATHに入れてください。

UDP 9000が使用中
: SRT Listenerが起動できません。`Get-NetUDPEndpoint -LocalPort 9000`で確認し、不要なプロセスを停止してください。

UDP 4433が使用中
: WebTransport serverが起動できません。`Get-NetUDPEndpoint -LocalPort 4433`で確認してください。

Viewerが`CONNECTING`または`ERROR`のまま
: `make browser-open`でWebTransport用フラグ付きの専用ブラウザを開いてください。手動で開く場合は、`make run`が表示した`certHash`付きURLを使ってください。

ingestが`LISTENING`から変わらない
: `make stream-start`が動いているか、FFmpegがSRT送信できているか確認してください。

映像が再生されない
: `/api/stream`が`LIVE`で、`latestSequence`が増えているか確認してください。ブラウザの自動再生制限がある場合は動画を手動再生してください。

残ったプロセスを止めたい
: まず`make stream-stop`、次に`make stop`を実行してください。まだ残る場合はPIDを確認して`Stop-Process -Id <PID>`で止めます。

## 品質ゲート

変更前後の確認:

```powershell
make lint
make test
make build
make e2e
```

`make e2e`はChromeを使い、E2E-001〜008が`8 passed / 0 skipped`になることを期待します。
