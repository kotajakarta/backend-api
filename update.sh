#!/bin/bash
cd /data/podman-hosting/apps/backend-api
git fetch origin main
git reset --hard origin/main
git clean -fd
podman exec -it daimi-api npm install --production
podman exec -it daimi-api npx prisma generate
podman exec -it daimi-api npx prisma migrate deploy
systemctl --user restart daimi-api.service
echo "Deployment Sukses!"