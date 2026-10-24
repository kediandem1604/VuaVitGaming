#!/usr/bin/env bash
# Để bot tự tạo nhóm kênh "GGD Hub" (lịch-chơi, vote-mvp, thông-báo) trên server Discord và
# ghi ID ba kênh vào deploy/server/.env (README mục 6C.3). Chạy lại an toàn: kênh cùng tên
# được dùng lại. Cuối cùng in danh sách role của server kèm ID để điền role admin/mod.
#
#   bash deploy/server/discord-setup.sh
#
# Cần trước: DISCORD_TOKEN và DISCORD_GUILD_ID trong .env; bot đã được mời vào server với
# quyền Manage Channels (README mục 2.2).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
env_file="$here/.env"

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

cd "$here"
echo "==> Build ảnh ứng dụng (lần đầu lâu: 5–30 phút tuỳ máy; update.sh dùng lại kết quả này)"
sudo docker compose build app

echo "==> Bot tạo kênh"
out="$(sudo docker compose run --rm --no-deps -T app node dist/server/tools/setup-discord.js)"

written=0
while IFS= read -r line; do
  case "$line" in
    DISCORD_SCHEDULE_CHANNEL_ID=* | DISCORD_VOTE_CHANNEL_ID=* | DISCORD_ANNOUNCE_CHANNEL_ID=*)
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

if [ "$written" -ne 3 ]; then
  echo "Không nhận đủ ID kênh từ bot — xem thông báo phía trên." >&2
  exit 1
fi

cat <<EOF

Đã ghi ID 3 kênh vào deploy/server/.env.
Tiếp theo:
  1. Chép ID role admin/mod ở danh sách trên vào DISCORD_ADMIN_ROLE_IDS và DISCORD_MOD_ROLE_IDS:
       nano deploy/server/.env
  2. Chạy ứng dụng:  bash deploy/server/update.sh
EOF
