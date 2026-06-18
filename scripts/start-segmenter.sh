#!/usr/bin/env sh
set -eu

SRT_LISTEN_HOST="${SRT_LISTEN_HOST:-0.0.0.0}"
SRT_LISTEN_PORT="${SRT_LISTEN_PORT:-9000}"
SRT_LATENCY_US="${SRT_LATENCY_US:-200000}"
MEDIA_DIR="${MEDIA_DIR:-media/live}"
SEGMENT_MODE="${SEGMENT_MODE:-encode}"

mkdir -p "${MEDIA_DIR}"

INPUT_URL="srt://${SRT_LISTEN_HOST}:${SRT_LISTEN_PORT}?mode=listener&latency=${SRT_LATENCY_US}"

if [ "${SEGMENT_MODE}" = "copy" ]; then
  VIDEO_ARGS="-c:v copy"
  AUDIO_ARGS="-c:a copy"
else
  VIDEO_ARGS="-c:v libx264 -profile:v high -level:v 3.1 -pix_fmt yuv420p -preset veryfast -tune zerolatency -b:v 2M -maxrate 2M -bufsize 4M -g 30 -keyint_min 30 -sc_threshold 0"
  AUDIO_ARGS="-c:a aac -b:a 128k -ar 48000 -ac 2"
fi

# shellcheck disable=SC2086
exec ffmpeg \
  -hide_banner \
  -loglevel info \
  -fflags +genpts \
  -i "${INPUT_URL}" \
  -map 0:v:0 \
  -map 0:a:0 \
  ${VIDEO_ARGS} \
  ${AUDIO_ARGS} \
  -f hls \
  -hls_segment_type fmp4 \
  -hls_time 1 \
  -hls_flags independent_segments \
  -start_number 1 \
  -hls_fmp4_init_filename "${MEDIA_DIR}/init.mp4" \
  -hls_segment_filename "${MEDIA_DIR}/segment-%06d.m4s" \
  "${MEDIA_DIR}/internal.m3u8"
