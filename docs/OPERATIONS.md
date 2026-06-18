# 起動・運用手順

## 1. 必要環境

- Docker DesktopまたはDocker Engine
- Docker Compose
- Make
- ChromeまたはEdge
- ローカル証明書を信頼登録できる権限

## 2. 初回

```bash
make bootstrap
make cert
```

生成された証明書をローカルで信頼する。具体的手順はOS別にREADMEへ実装時追記する。

## 3. 起動

```bash
make run
```

想定URL:

```text
Viewer: https://localhost:5173
API: https://localhost:4433/api/health
WebTransport: https://localhost:4433/webtransport/live-001
```

## 4. SRT Listener起動

`make run`でserverとSRT Listenerを起動する。

確認:

```bash
curl -k https://localhost:4433/api/ingest
```

`state`が`LISTENING`であることを確認する。

## 5. テスト映像開始

別ターミナルからSRT Callerを開始する。

```bash
make stream-start
```

Callerは次へ送信する。

```text
srt://localhost:9000?mode=caller&latency=200000
```

## 6. 状態確認

```bash
curl -k https://localhost:4433/api/stream
curl -k https://localhost:4433/api/metrics
```

## 7. 配信終了

```bash
make stream-stop
```

または:

```bash
curl -k -X POST https://localhost:4433/api/stream/end
```

## 8. ログ確認

```bash
docker compose logs -f server
docker compose logs -f viewer
docker compose logs -f segmenter
```

必須ログfield:

```json
{
  "timestamp": "ISO-8601",
  "level": "INFO",
  "event": "segment_sent",
  "sessionId": "uuid",
  "sequence": 120,
  "viewerCount": 3,
  "bytes": 248392
}
```

## 9. 障害切り分け

### SRT ingest接続不可

確認順:

1. FFmpegが`--enable-libsrt`でビルドされているか
2. UDP 9000がlistenされているか
3. EncoderがCaller、ServerがListenerになっているか
4. MPEG-TSで送信しているか
5. H.264 videoとAAC audioが存在するか
6. Docker利用時にUDP 9000がpublishされているか
7. ingest FFmpeg stderr

### WebTransport接続不可

確認順:

1. Chrome/Edgeで開いているか
2. 証明書が信頼されているか
3. UDP 4433が利用可能か
4. HTTP/3 serverが起動しているか
5. DevTools consoleの接続error
6. server logのsession作成有無

### MSEエラー

確認順:

1. `MediaSource.isTypeSupported(mimeType)`
2. init segmentが最初にappendされたか
3. sequenceが連続しているか
4. SourceBufferが`updating`中でないか
5. FFmpeg出力とMIME typeが一致するか
6. `video.error`のMediaError code

### 再生が遅れる

確認順:

1. viewerのlatency表示
2. viewer queue長
3. serverのslow consumer log
4. segment生成間隔
5. SourceBufferのbuffer range
6. playbackRateとseek実行履歴

## 10. 実験結果として記録する値

- 初回再生開始時間
- 途中参加開始時間
- 30秒時点の遅延
- 10 viewer時のserver CPU・memory
- viewerごとの平均送信bitrate
- 再接続時間
- 欠落segment数
- slow consumer発生数


### SRT再接続後に再生復帰しない

確認順:

1. stream stateがINTERRUPTEDからLIVEへ戻ったか
2. 新しいinit.mp4が生成されたか
3. 古いring bufferが破棄されたか
4. viewerへdiscontinuityが送られたか
5. viewerがMediaSourceを再生成したか
