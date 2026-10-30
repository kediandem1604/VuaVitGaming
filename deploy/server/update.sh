#!/usr/bin/env bash
# Chạy (lần đầu) hoặc cập nhật GGD Hub trên máy chủ Ubuntu (README mục 6C):
#
#   bash deploy/server/update.sh            # tải ảnh build sẵn từ GitHub (1–3 phút)
#   bash deploy/server/update.sh --build    # build ảnh ngay trên máy (chậm, 15–35 phút)
#
# Kéo code mới của nhánh đang checkout, kiểm tra .env đã đủ biến, tải ảnh ứng dụng đúng commit
# đó (GitHub Actions build sẵn — .github/workflows/docker.yml) và khởi động lại những gì thay
# đổi. Dữ liệu database và chứng chỉ HTTPS nằm trong volume, không mất.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
env_file="$here/.env"

build=0
for arg in "$@"; do
  case "$arg" in
    --build) build=1 ;;
    *)
      echo "Tham số không hợp lệ: $arg (chỉ có --build)" >&2
      exit 1
      ;;
  esac
done

# Kéo code trước, rồi chạy lại chính script này từ bản vừa kéo về — để thay đổi của update.sh
# (và các file nó dùng) có hiệu lực ngay trong lần cập nhật này.
if [ -z "${GGD_UPDATE_PULLED:-}" ]; then
  echo "==> Kéo code mới"
  git -C "$here/../.." pull --ff-only
  exec env GGD_UPDATE_PULLED=1 bash "$here/update.sh" "$@"
fi

if [ ! -f "$env_file" ]; then
  echo "Chưa có $env_file — chạy bash deploy/server/setup.sh trước." >&2
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
  echo "Còn thiếu trong deploy/server/.env: ${missing[*]}" >&2
  echo "Mở bằng: nano deploy/server/.env" >&2
  if [[ " ${missing[*]} " == *"_CHANNEL_ID "* ]]; then
    echo "Chưa có kênh? Để bot tự tạo kênh và điền ID: bash deploy/server/discord-setup.sh" >&2
  fi
  exit 1
fi

# shellcheck source=deploy/server/app-image.sh
source "$here/app-image.sh"
cd "$here"
get_app_image

echo "==> Khởi động"
"${compose[@]}" up -d --remove-orphans
sudo docker image prune -f >/dev/null

site="$(grep -E '^SITE_ADDRESS=' "$env_file" | tail -n 1 | cut -d= -f2-)"
cat <<EOF

Đang chạy. Kiểm tra:
  - Trạng thái:  sudo docker compose -f deploy/server/docker-compose.yml ps
  - Log app:     sudo docker compose -f deploy/server/docker-compose.yml logs -f app
  - Web:         https://$site/healthz   (lần đầu Caddy cần ~1 phút để lấy chứng chỉ HTTPS)
EOF
