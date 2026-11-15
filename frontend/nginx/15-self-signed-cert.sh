#!/bin/sh
# Creates a self-signed certificate for localhost on first start, unless a certificate was mounted at
# /etc/nginx/certs/tls.crt + tls.key (do that for any real deployment). Runs from /docker-entrypoint.d/.
set -eu
dir=/etc/nginx/certs
if [ ! -s "$dir/tls.crt" ] || [ ! -s "$dir/tls.key" ]; then
  mkdir -p "$dir"
  openssl req -x509 -newkey rsa:2048 -nodes -days 365 \
    -subj "/CN=localhost" \
    -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" \
    -keyout "$dir/tls.key" -out "$dir/tls.crt" 2>/dev/null
  chmod 600 "$dir/tls.key"
  echo "15-self-signed-cert.sh: created a self-signed certificate for localhost (valid 365 days)"
fi
