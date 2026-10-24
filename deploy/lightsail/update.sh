#!/usr/bin/env bash
# Chạy (lần đầu) hoặc cập nhật GGD Hub trên Lightsail (README mục 6C):
#
#   bash deploy/lightsail/update.sh
#
# Kéo code mới của nhánh đang checkout, kiểm tra .env đã đủ biến, build lại ảnh và khởi động
# lại những gì thay đổi. Dữ liệu database và chứng chỉ HTTPS nằm trong volume, không mất.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
env_file="$here/.env"

if [ ! -f "$env_file" ]; then
  echo "Chưa có $env_file — chạy bash deploy/lightsail/setup.sh trước." >&2
  exit 1
fi

# Biến bắt buộc còn trống → dừng và nói rõ, thay vì để ứng dụng khởi động rồi chết lặp lại.
required=(SITE_ADDRESS POSTGRES_PASSWORD SESSION_SECRET DISCORD_TOKEN DISCORD_CLIENT_ID
  DISCORD_CLIENT_SECRET DISCORD_GUILD_ID DISCORD_SCHEDULE_CHANNEL_ID DISCORD_VOTE_CHANNEL_ID
  DISCORD_ANNOUNCE_CHANNEL_ID DISCORD_ADMIN_ROLE_IDS DISCORD_MOD_ROLE_IDS BREVO_API_KEY MAIL_FROM)
missing=()
for key in "${required[@]}"; do
  value="$(grep -E "^${key}=" "$env_file" | tail -n 1 | cut -d= -f2- || true)"
  [ -n "${value// /}" ] || missing+=("$key")
done
if [ "${#missing[@]}" -gt 0 ]; then
  echo "Còn thiếu trong deploy/lightsail/.env: ${missing[*]}" >&2
  echo "Mở bằng: nano deploy/lightsail/.env" >&2
  exit 1
fi

echo "==> Kéo code mới"
git -C "$here/../.." pull --ff-only

echo "==> Build và khởi động (lần đầu mất vài phút)"
cd "$here"
sudo docker compose up -d --build --remove-orphans
sudo docker image prune -f >/dev/null

site="$(grep -E '^SITE_ADDRESS=' "$env_file" | tail -n 1 | cut -d= -f2-)"
cat <<EOF

Đang chạy. Kiểm tra:
  - Trạng thái:  sudo docker compose -f deploy/lightsail/docker-compose.yml ps
  - Log app:     sudo docker compose -f deploy/lightsail/docker-compose.yml logs -f app
  - Web:         https://$site/healthz   (lần đầu Caddy cần ~1 phút để lấy chứng chỉ HTTPS)
EOF
