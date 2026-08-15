#!/bin/sh
set -eu

# Bind mounts retain the host directory's ownership instead of the ownership
# baked into the image. Repair it before dropping to the unprivileged user.
mkdir -p /data/app /data/telegram /data/media
chown -R node:node /data

exec gosu node "$@"
