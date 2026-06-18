# 設計判断記録

## ADR-001 WebTransport + MSE

Status: Accepted

WebRTCを使用せず、セグメントをPushする目的からWebTransportを採用する。ブラウザ再生にはMSEを使用する。

## ADR-002 CMAF/fMP4

Status: Accepted

ブラウザのMSEへappend可能で、init segmentとmedia segmentを分離できるため採用する。

## ADR-003 単一多重化SourceBuffer

Status: Accepted

映像・音声を1つのfMP4へ多重化し、SourceBufferを1つにする。音声・映像別trackの同期制御を初期スコープから除外する。

## ADR-004 1秒GOP・1秒segment

Status: Accepted

途中参加と欠落復旧を単純化するため、全segmentを独立再生可能にする。圧縮効率は評価対象外とする。

## ADR-005 FFmpeg DASH muxerの内部利用

Status: Accepted

安定したCMAF/fMP4生成のため、FFmpeg内部ではDASH muxerを利用できる。ただし生成マニフェストは配信サーバ・viewerから利用せず、公開しない。

実験の禁止対象は「視聴制御にマニフェストを利用すること」であり、「セグメンター内部が副生成物としてマニフェストを書くこと」ではない。

## ADR-006 単一プロセスserver

Status: Accepted

最大10 viewerの実験であり、分散構成は検証目的を損なうため採用しない。

## ADR-007 reliable streamのみ

Status: Accepted

初期実装では欠落・再送特性を単純化するため、WebTransport datagramを使わない。

## 未決事項

Codexが実装中に判断を要する場合、この節へ次の形式で追記する。

```text
## ADR-XXX タイトル

Status: Proposed

Context:
Decision:
Consequences:
```


## ADR-008 SRT ingest

Status: Accepted

Encoderから配信サーバーへの入力プロトコルとしてSRTを採用する。コンテナはMPEG-TS、映像はH.264、音声はAACとする。

EncoderをCaller、配信サーバーをListenerとする。公衆インターネットおよびLANの双方で扱いやすく、FFmpeg、OBS、ハードウェアエンコーダーへ展開しやすいため採用する。

## ADR-009 SRT処理をFFmpegへ委譲

Status: Accepted

Pythonアプリケーション内でSRTを実装せず、FFmpegをSRT Listenerとして起動する。PythonはFFmpeg子プロセスの状態管理、segment監視、WebTransport配信に集中する。

## ADR-010 SRT payloadにMPEG-TSを使用

Status: Accepted

SRT自体はメディアコンテナを規定しないため、相互運用性の高いMPEG-TSをpayloadとして使用する。初期実装では1 program、H.264 video 1 track、AAC audio 1 trackに限定する。

## ADR-011 ingest再接続時は新規MediaSource

Status: Accepted

SRT再接続後はtimestamp、codec configuration、init segmentが変わる可能性がある。既存SourceBufferへの継続appendは行わず、viewerは新しいMediaSourceを作成して最新位置から再生し直す。


## ADR-012 Codex指摘を永続ルールとして管理

Status: Accepted

再利用可能な指摘は`docs/CODEX_RULES.md`へ登録する。
技術選定やトレードオフを含む判断は`docs/DECISIONS.md`へ記録する。
各ルールには検証方法を含める。
