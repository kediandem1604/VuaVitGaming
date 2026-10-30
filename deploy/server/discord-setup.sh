#!/usr/bin/env bash
# Để bot tự tạo nhóm kênh "GGD Hub" (lịch-chơi, vote-mvp, thông-báo, highlight, treo-thưởng) trên
# server Discord và ghi ID năm kênh vào deploy/server/.env (README mục 6C.3). Chạy lại an toàn: ID
# kênh đã có trong .env được giữ nguyên (kể cả khi kênh/nhóm đã đổi tên), kênh cùng tên được
# dùng lại (máy đã có các kênh cũ chỉ được thêm kênh còn thiếu, vd #treo-thưởng). Cuối cùng in danh sách role của
# server kèm ID để điền role admin/mod.
#
#   bash deploy/server/discord-setup.sh            # tải ảnh build sẵn từ GitHub
#   bash deploy/server/discord-setup.sh --build    # build ảnh ngay trên máy (chậm)
#
# Cần trước: DISCORD_TOKEN và DISCORD_GUILD_ID trong .env; bot đã được mời vào server với
# quyền Manage Channels và Attach Files (README mục 2.2).
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

if [ ! -f "$env_file" ]; then
  echo "Chưa có $env_file — chạy bash deploy/server/setup.sh trước." >&2
  exit 1
fi
for key in DISCORD_TOKEN DISCORD_GUILD_ID; do
  value="$(grep -E "^${key}=" "$env_file" | tail -n 1 | cut -d= -f2- || true)"
  if [ -z "${value// /}" ]; then
    echo "Còn thiếu $key trong deploy/server/.env (README mục 2–3). Mở bằng: nano deploy/server/.env" >&2
    exit 1
  fi
done

# shellcheck source=deploy/server/app-image.sh
source "$here/app-image.sh"
cd "$here"
get_app_image

echo "==> Bot tạo kênh"
out="$("${compose[@]}" run --rm --no-deps -T app node dist/server/tools/setup-discord.js)"

# .env sửa tay có thể thiếu xuống dòng cuối: thêm trước khi nối dòng mới, kẻo dính vào dòng cuối.
[ -n "$(tail -c1 "$env_file")" ] && echo >>"$env_file"

written=0
while IFS= read -r line; do
  case "$line" in
    DISCORD_SCHEDULE_CHANNEL_ID=* | DISCORD_VOTE_CHANNEL_ID=* | DISCORD_ANNOUNCE_CHANNEL_ID=* | DISCORD_HIGHLIGHT_CHANNEL_ID=* | DISCORD_BOUNTY_CHANNEL_ID=*)
      key="${line%%=*}"
      if grep -qE "^${key}=" "$env_file"; then
        sed -i "s|^${key}=.*|${line}|" "$env_file"
      else
        echo "$line" >>"$env_file"
      fi
      written=$((written + 1))
      ;;
  esac
done <<<"$out"

if [ "$written" -ne 5 ]; then
  echo "Không nhận đủ ID kênh từ bot — xem thông báo phía trên." >&2
  exit 1
fi

cat <<EOF

Đã ghi ID 5 kênh vào deploy/server/.env.
Tiếp theo:
  1. Chép ID role admin/mod ở danh sách trên vào DISCORD_ADMIN_ROLE_IDS và DISCORD_MOD_ROLE_IDS:
       nano deploy/server/.env
  2. Chạy ứng dụng:  bash deploy/server/update.sh
EOF
