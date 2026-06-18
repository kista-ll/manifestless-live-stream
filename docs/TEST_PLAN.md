# テスト計画

## 1. 単体テスト

### Server

- ingest stateが正しく遷移する
- FFmpeg終了時にINTERRUPTEDへ遷移する
- 再接続時に古いinitとring bufferを破棄する
- segmentファイル名からsequenceを抽出できる
- 不正ファイル名を無視する
- リングバッファが30件を超えない
- startSequenceが`max(oldest, latest - 2)`になる
- 11人目を拒否する
- viewer queue超過で古いsegmentを破棄する
- binary header encode/decodeが一致する
- payload 10MiB超過を拒否する
- sequence欠落をログ・metricへ反映する

### Viewer

- control NDJSONを分割受信しても復元できる
- binary headerを解析できる
- 順不同segmentをsequence順へ並べる
- 2秒待って欠落segmentをスキップする
- SourceBuffer更新中はappendしない
- latency条件に応じてseek/playbackRateを変更する
- stream_ended後に再接続しない

## 2. 結合テスト

- FFmpeg SRT CallerからListenerへMPEG-TSを送信できる
- SRT受信後にinit.mp4とmedia segmentが生成される
- FFmpeg出力をWatcherが検出する
- init segmentとmedia segmentをWebTransportで受信できる
- 途中参加時にlatest-2から送信される
- 管理APIのstateとviewer数が実態に一致する
- サーバ停止・再開でviewerが再接続する

## 3. E2E

Playwright + Chromiumを使用する。

### E2E-001 基本再生

1. サーバ起動
2. FFmpeg起動
3. viewerを開く
4. `PLAYING`を10秒待つ
5. `video.currentTime`が増加することを確認

### E2E-002 途中参加

1. 60秒配信
2. viewerを開く
3. 10秒以内にPLAYING
4. 最初の受信sequenceが接続時latest-5以上

### E2E-003 10 viewer

1. browser contextを10個作成
2. 全てPLAYING
3. APIのviewerCountが10

### E2E-004 capacity

1. 10 viewerを接続
2. 11番目を接続
3. 11番目がcapacity error
4. 既存10 viewerのcurrentTimeが増加

### E2E-005 catch up

1. PLAYINGを確認
2. video.pause()
3. 10秒待つ
4. video.play()
5. 30秒以内にlatency <= 5

### E2E-006 end

1. PLAYINGを確認
2. `POST /api/stream/end`
3. ENDEDを確認
4. 15秒間RECONNECTINGにならない

### E2E-007 SRT reconnect

1. SRT Callerで配信開始
2. PLAYINGを確認
3. Callerを停止
4. stream stateがINTERRUPTEDになることを確認
5. 10秒後にCallerを再開
6. 新しいinit segmentが生成される
7. 30秒以内にPLAYINGへ復帰する

### E2E-008 invalid ingest

1. 音声なしのSRT MPEG-TSを送信
2. stream stateがERRORまたはINTERRUPTEDになる
3. ログにaudio track不足が記録される

## 4. 手動試験

Chrome DevToolsで以下を確認する。

- `.m3u8`、`.mpd`へのリクエストがない
- セグメント一覧APIへのポーリングがない
- WebTransport sessionが確立している
- CPUとメモリが60秒間増加し続けない
- 10 viewer時に映像が継続する

## 5. 合格条件

- 全単体テスト成功
- 全結合テスト成功
- E2E-001〜008成功
- 重大な未処理例外なし
- AC-001〜011を試験結果へ記録
