#!/usr/bin/env bash
# Chuẩn bị một máy Lightsail Ubuntu 24.04 mới cho GGD Hub (README mục 6C). Chạy một lần,
# trong thư mục repo vừa clone:
#
#   bash deploy/lightsail/setup.sh
#
# Làm gì: cài Docker + Compose, tạo 2 GB swap (máy 1 GB RAM build ảnh Docker cần thêm bộ nhớ),
# tạo deploy/lightsail/.env từ .env.example và tự điền SITE_ADDRESS (theo IP công khai của máy),
# mật khẩu database và SESSION_SECRET ngẫu nhiên. Chạy lại an toàn: không ghi đè .env đã có.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
env_file="$here/.env"

echo "==> Cài Docker và Docker Compose"
sudo apt-get update -y
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io docker-compose-v2 openssl curl
sudo systemctl enable --now docker

echo "==> Swap 2 GB"
if ! swapon --show | grep -q '/swapfile'; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null
  sudo swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
else
  echo "    đã có, bỏ qua"
fi

echo "==> File cấu hình $env_file"
if [ -f "$env_file" ]; then
  echo "    đã có, giữ nguyên (xoá file đó nếu muốn tạo lại)"
else
  ip="$(curl -fsS https://checkip.amazonaws.com | tr -d '[:space:]')"
  if ! [[ "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Không lấy được IP công khai của máy (nhận: '$ip')." >&2
    exit 1
  fi
  site="${ip//./-}.sslip.io"
  cp "$here/.env.example" "$env_file"
  chmod 600 "$env_file"
  sed -i \
    -e "s|^SITE_ADDRESS=.*|SITE_ADDRESS=$site|" \
    -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 24)|" \
    -e "s|^SESSION_SECRET=.*|SESSION_SECRET=$(openssl rand -hex 32)|" \
    "$env_file"
  echo "    đã tạo; địa chỉ web: https://$site"
fi

mkdir -p "$here/backups"

cat <<EOF

Xong phần chuẩn bị. Tiếp theo:
  1. Điền Discord và email:   nano deploy/lightsail/.env    (Ctrl+O, Enter để lưu; Ctrl+X để thoát)
  2. Chạy ứng dụng:           bash deploy/lightsail/update.sh
EOF
