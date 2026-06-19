# 起動・運用手順

README.mdは初回利用者向けの正本です。このファイルは詳細な構成確認、障害切り分け、後片付けの補足として扱います。

## プロセス構成

`make run`はローカルで次を起動する。

| 役割 | プロセス | URL / Port |
|---|---|---|
| WebTransport server | `python -m manifestless_server.e2e_server` | UDP `127.0.0.1:4433` |
| HTTP管理API | 同上 | TCP `127.0.0.1:8000` |
| Viewer | `npm --prefix apps/viewer run dev -- --host 127.0.0.1` | `http://127.0.0.1:5173` |
| SRT Listener / segmenter | `ffmpeg` | UDP `0.0.0.0:9000` |

WebTransport endpoint:

```text
https://127.0.0.1:4433/webtransport/live-001
```

HTTP API:

```text
http://127.0.0.1:8000/api/health
http://127.0.0.1:8000/api/ingest
http://127.0.0.1:8000/api/stream
http://127.0.0.1:8000/api/metrics
```

## Windows手順

GNU MakeがPATHにない場合:

```powershell
$env:Path = 'C:\Program Files (x86)\GnuWin32\bin;' + $env:Path
```

これは現在のPowerShellだけに効く一時設定である。`make run`と`make stream-start`を別PowerShellで実行する場合は、それぞれのPowerShellで実行する。

Python 3.13の場所を明示する場合:

```powershell
make PYTHON='C:/Users/y-aka/AppData/Local/Programs/Python/Python313/python.exe' bootstrap
```

## 証明書

生成方法:

```powershell
make cert
```

実ファイル:

```text
scripts/generate-cert.py
scripts/generate-cert.sh
```

生成物:

```text
certs/localhost.crt
certs/localhost.key
```

証明書はECDSA P-256の自己署名証明書で、`manifestless_server.certs.ensure_localhost_cert()`が生成する。`make run`起動時にも、証明書が存在しない、またはECDSAでない場合は再生成される。

Chromium Viewerは`serverCertificateHashes`へSHA-256証明書ハッシュを渡す。`make run`が表示する`certHash`付きURLを使う場合、OSの証明書ストアへ信頼登録する必要はない。`certHash`なしで開く場合はWebTransport handshakeに失敗する可能性が高い。

手動起動済みのChrome/EdgeではWebTransport関連フラグが効かず、`ERR_QUIC_PROTOCOL_ERROR.QUIC_NETWORK_IDLE_TIMEOUT`になることがある。視聴確認は専用プロファイルで起動する。証明書はViewer URLの`certHash`を使うため、OSへの信頼登録や`--ignore-certificate-errors`は使わない。

```powershell
make browser-open
```

`browser-open`は次のフラグを付けてChromeまたはEdgeを起動する。

```text
--user-data-dir=tmp/chrome-webtransport-profile
--enable-quic
--enable-features=WebTransportDeveloperMode
--autoplay-policy=no-user-gesture-required
```

`browser-open`でも`QUIC_NETWORK_IDLE_TIMEOUT`が続く場合は、E2Eと同じPlaywright起動経路を使う。Chrome画面に「サポートされていないフラグ」と表示される場合があるが、E2Eと同じ起動条件へ合わせるための警告表示である。

```powershell
make browser-test-open
```

`browser-test-open`で再生できる場合、通常Chrome起動時のプロファイル、既存プロセス、ポリシー、またはセキュリティソフトによるUDP/QUIC制御を疑う。`browser-test-open`でも失敗する場合は、server logにQUIC handshakeが出ているか、UDP 4433が解放されているか、`certHash`が現在のserver証明書と一致しているかを確認する。

`make run`を実行しているPowerShellで、ブラウザ接続時に次のようなログが出ればUDP 4433はサーバへ届いている。

```text
Negotiated protocol version
ALPN negotiated protocol h3
webtransport_session_accepted
```

これらが出ずにブラウザだけが`QUIC_NETWORK_IDLE_TIMEOUT`になる場合、ChromeからPythonのUDP listenerへパケットが届いていない。次を確認する。

```powershell
Get-NetUDPEndpoint -LocalPort 4433
Get-Process python,chrome,msedge -ErrorAction SilentlyContinue
```

UDP 4433のlistenerが存在しない場合は`make run`を再起動する。listenerがあるのにログが出ない場合は、Windows Defender Firewall、セキュリティソフト、VPN、または企業ポリシーでlocalhost UDP/QUICが遮断されていないか確認する。

ChromeのQUICがポリシーで無効化されている場合も同じ症状になる。`browser-test-open`で開いたChromeのアドレスバーに`chrome://policy`を入力し、`QuicAllowed`が`false`や無効状態になっていないか確認する。

## SRT起動順

1. `make run`
2. `/api/ingest`が`LISTENING`であることを確認
3. 別PowerShellで`make stream-start`
4. `/api/ingest`が`CONNECTED`、`/api/stream`が`LIVE`へ遷移することを確認

SRT Caller URL:

```text
srt://127.0.0.1:9000?mode=caller&latency=200000&pkt_size=1316
```

SRT Listener URL:

```text
srt://0.0.0.0:9000?mode=listener&latency=200000
```

## API期待状態

起動直後:

```powershell
curl.exe -s http://127.0.0.1:8000/api/health
curl.exe -s http://127.0.0.1:8000/api/ingest
curl.exe -s http://127.0.0.1:8000/api/stream
```

期待値:

```text
health.status = ok
ingest.state = LISTENING
stream.state = WAITING_FOR_INGEST
stream.segmentCount = 0
```

配信開始後:

```text
ingest.state = CONNECTED
stream.state = LIVE
stream.latestSequence = 増加する整数
stream.segmentCount > 0
```

配信途絶時:

```text
ingest.state = INTERRUPTED
stream.state = INTERRUPTED
```

不正入力時:

```text
ingest.state = ERROR
stream.state = ERROR
ingest.lastError.code = VIDEO_TRACK_MISSING など
```

## stream end後の再起動

stream end:

```powershell
curl.exe -s -X POST http://127.0.0.1:8000/api/stream/end
```

再起動する場合:

```powershell
make stream-stop
make stop
make clean
make run
make stream-start
```

`make run`は起動時に`media/live`内の生成済みmediaを削除するため、古いsegmentを読み込まない。

## ログ確認

`make run`を直接表示しているPowerShellに、server、viewer、segmenterのログがprefix付きで出る。

バックグラウンドで起動している検証時は、次を確認する。

```powershell
Get-Content tmp/run.log -Tail 80
Get-Content tmp/run.err.log -Tail 80
Get-Content tmp/stream.err.log -Tail 80
```

重要イベント:

```text
WT_READY certHash=...
ingest_connected
segment_registered
segment_sent
ingest_disconnected
```

## 停止

テスト入力だけ止める:

```powershell
make stream-stop
```

プロジェクトのローカルプロセスを止める:

```powershell
make stop
```

残プロセス確認:

```powershell
Get-Process node,python,ffmpeg -ErrorAction SilentlyContinue
Get-NetUDPEndpoint -LocalPort 9000,4433 -ErrorAction SilentlyContinue
```

必要な場合:

```powershell
Stop-Process -Id <PID>
```

## 後片付け

```powershell
make clean
```

削除対象:

- `media/live/init.mp4`
- `media/live/internal.m3u8`
- `media/live/*.m4s`
- `media/live/*.tmp`
- `certs`
- `tmp`
- `.mypy_cache`
- `.ruff_cache`
- `apps/viewer/dist`
- `apps/server`と`apps/viewer`配下のテスト・キャッシュ生成物
- `test-results`
- `playwright-report`
- `coverage`

`media/live/.gitkeep`は残る。

## 障害切り分け

### `make`が見つからない

```powershell
$env:Path = 'C:\Program Files (x86)\GnuWin32\bin;' + $env:Path
make help
```

PowerShellを新しく開いた場合、この一時PATH設定は引き継がれない。恒久設定した場合も、反映にはPowerShellを開き直す必要がある。

### Pythonが`Access is denied`

実行可能なPython 3.13を指定する。

```powershell
make PYTHON='C:/path/to/python.exe' bootstrap
```

### FFmpegがSRT非対応

```powershell
ffmpeg -protocols | Select-String srt
```

何も出ない場合はlibsrt対応ビルドをPATHに入れる。

### UDP 9000が使用中

```powershell
Get-NetUDPEndpoint -LocalPort 9000
```

不要なFFmpegや別アプリを停止する。

### UDP 4433が使用中

```powershell
Get-NetUDPEndpoint -LocalPort 4433
```

別のWebTransport serverが残っている場合は`make stop`を実行する。

### ViewerがCONNECTINGまたはERRORのまま

- ChromeまたはEdgeで開いているか
- まず`make browser-open`で専用プロファイルのブラウザを開いているか
- 手動で開く場合は`make run`が表示した`certHash`付きURLを使っているか
- `/api/stream`が`LIVE`か
- DevTools consoleに`Opening handshake failed`や`QUIC_NETWORK_IDLE_TIMEOUT`がないか

### ingestがLISTENINGから変わらない

- `make stream-start`が実行中か
- FFmpeg stderrにSRT接続エラーがないか
- UDP 9000がListenerへ届いているか

### 映像が再生されない

- `media/live/init.mp4`と`segment-*.m4s`が生成されているか
- `stream.latestSequence`が増加しているか
- Viewerの`Error`表示を確認
- ブラウザの自動再生制限により手動再生が必要でないか

## Docker

`compose.yaml`は存在するが、現在の初回起動・E2E検証はローカルプロセスで実施している。READMEの手順ではDockerを使わない。

Dockerで実行する場合は、`.env.example`、証明書mount、UDP 4433/9000 publish、FFmpeg入りイメージの整合確認が別途必要。

## 実装済みE2E結果

`docs/TEST_RESULTS.md`に記録する。直近の期待値:

```text
make e2e
8 passed / 0 skipped
```
