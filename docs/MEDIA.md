# メディア仕様

## 0. Ingest仕様

| 項目 | 値 |
|---|---|
| プロトコル | SRT |
| 接続モード | Encoder = Caller / Server = Listener |
| 待受 | `0.0.0.0:9000/udp` |
| コンテナ | MPEG-TS |
| 映像 | H.264/AVC |
| 音声 | AAC-LC |
| 推奨SRT latency | 200ms |
| 暗号化 | 初期実装ではなし |

SRT ListenerはPythonではなくFFmpegが担当する。

## 1. 固定プロファイル

| 項目 | 値 |
|---|---|
| 映像コーデック | H.264/AVC |
| H.264 profile | High |
| level | 3.1 |
| pixel format | yuv420p |
| 解像度 | 1280x720 |
| フレームレート | 30fps |
| 映像bitrate | 2Mbps |
| GOP | 30 frames |
| scene cut | 無効 |
| 音声コーデック | AAC-LC |
| sample rate | 48kHz |
| channels | stereo |
| 音声bitrate | 128kbps |
| コンテナ | fragmented MP4 |
| segment duration | 1秒 |

MIME type:

```text
video/mp4; codecs="avc1.64001f,mp4a.40.2"
```

実際のFFmpeg出力とMIME typeが一致することをテストで確認する。

## 2. 初期入力

最初の受入試験ではFFmpeg lavfiを使う。

```bash
ffmpeg \
  -re \
  -f lavfi -i "testsrc2=size=1280x720:rate=30" \
  -f lavfi -i "sine=frequency=1000:sample_rate=48000" \
  -c:v libx264 \
  -profile:v high \
  -level:v 3.1 \
  -pix_fmt yuv420p \
  -preset veryfast \
  -tune zerolatency \
  -b:v 2M \
  -maxrate 2M \
  -bufsize 4M \
  -g 30 \
  -keyint_min 30 \
  -sc_threshold 0 \
  -c:a aac \
  -b:a 128k \
  -ar 48000 \
  -ac 2 \
  -f dash \
  -streaming 1 \
  -use_template 1 \
  -use_timeline 0 \
  -seg_duration 1 \
  -init_seg_name "init.mp4" \
  -media_seg_name "segment-$Number%06d$.m4s" \
  -remove_at_exit 0 \
  /media/live/internal.mpd
```

FFmpegのDASH muxerはfMP4を安定生成するためだけに使用する。生成された`internal.mpd`はサーバ・viewerから参照せず、外部公開しない。実験上「マニフェスト不使用」とは、配信制御・視聴開始・セグメント取得にマニフェストを使わないことを指す。

Codexは、環境のFFmpegで上記オプションが期待どおり動かない場合、同等のfMP4出力になるコマンドへ調整し、理由を`docs/DECISIONS.md`へ記録する。

## 3. 完成ファイル判定

Watcherは書き込み途中のファイルを読んではならない。

優先方式:

1. FFmpeg出力先を一時ディレクトリにする。
2. ファイルサイズが200ms間変化しないことを確認する。
3. application側が配信用ディレクトリへatomic renameする。

簡略実装で直接監視する場合も、サイズ安定確認を必須とする。

## 4. sequence

ファイル名:

```text
segment-000001.m4s
segment-000002.m4s
```

正規表現:

```regex
^segment-(\d{6})\.m4s$
```

## 5. 検証

`ffprobe`で以下を確認する。

- init/mediaがISO BMFFとして読める
- 映像30fps
- H.264 High 3.1
- AAC 48kHz stereo
- 各media segmentがおおむね1秒
- 各segment先頭が独立再生可能


## 6. Ingest切断・再接続

- SRT Caller切断時、FFmpeg ingest終了または入力EOFを検知する。
- Stream stateを`INTERRUPTED`へ遷移する。
- 既存viewerへ`discontinuity`を通知する。
- FFmpeg Listenerを再起動して次のCaller接続を待つ。
- 再接続後は古いinit segmentとリングバッファを破棄する。
- 新しいinit segment生成後にStream stateを`LIVE`へ戻す。
- viewerは新しいMediaSourceを生成して再初期化する。

## 7. 入力検証

`ffprobe`またはFFmpeg stderrから以下を確認する。

- video trackが1つ存在する
- audio trackが1つ存在する
- video codecがH.264
- audio codecがAAC
- 解像度、fps、sample rateをログへ出す
- stream copy可能条件を満たすか判定する
