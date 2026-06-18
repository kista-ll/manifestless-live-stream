#!/usr/bin/env sh
set -eu

SRT_HOST="${SRT_HOST:-127.0.0.1}"
SRT_PORT="${SRT_PORT:-9000}"
SRT_LATENCY_US="${SRT_LATENCY_US:-200000}"
DURATION_ARGS=""

if [ "${STREAM_DURATION_SECONDS:-}" != "" ]; then
  DURATION_ARGS="-t ${STREAM_DURATION_SECONDS}"
fi

OUTPUT_URL="srt://${SRT_HOST}:${SRT_PORT}?mode=caller&latency=${SRT_LATENCY_US}&pkt_size=1316"

# shellcheck disable=SC2086
exec ffmpeg \
  -hide_banner \
  -loglevel info \
  -re \
  -f lavfi -i "testsrc2=size=1280x720:rate=30" \
  -f lavfi -i "sine=frequency=1000:sample_rate=48000" \
  ${DURATION_ARGS} \
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
  -f mpegts \
  "${OUTPUT_URL}"
