#!/usr/bin/env bash
# Chuẩn bị một máy Debian 13 / Ubuntu 24.04 mới (Google Cloud, AWS Lightsail…) cho GGD Hub
# (README mục 6C).
# Chạy một lần, trong thư mục repo vừa clone:
#
#   bash deploy/server/setup.sh
#
# Làm gì: cài Docker + Compose (kho chính thức của Docker), tạo 2 GB swap (máy 1 GB RAM build ảnh Docker cần thêm bộ nhớ),
# tạo deploy/server/.env từ .env.example và tự điền SITE_ADDRESS (theo IP công khai của máy),
# mật khẩu database và SESSION_SECRET ngẫu nhiên. Chạy lại an toàn: không ghi đè .env đã có.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
env_file="$here/.env"

echo "==> Cài Docker và Docker Compose"
# Dùng kho chính thức của Docker (download.docker.com) — cùng một cách cho Debian (ảnh mặc
# định của Google Cloud) và Ubuntu (Lightsail); gói docker của từng bản Linux đặt tên Compose
# khác nhau (Ubuntu: docker-compose-v2, Debian: không có).
. /etc/os-release
case "${ID:-}" in
  debian | ubuntu) ;;
  *)
    echo "Script này chỉ hỗ trợ Debian hoặc Ubuntu (máy đang chạy: ${PRETTY_NAME:-không rõ})." >&2
    exit 1
    ;;
esac
if ! sudo docker compose version >/dev/null 2>&1; then
  sudo apt-get update -y
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl openssl
  sudo install -m 0755 -d /etc/apt/keyrings
  sudo curl -fsSL "https://download.docker.com/linux/$ID/gpg" -o /etc/apt/keyrings/docker.asc
  sudo chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/$ID $VERSION_CODENAME stable" |
    sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update -y
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y \
    docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
else
  echo "    đã có, bỏ qua"
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y openssl curl >/dev/null
fi
sudo systemctl enable --now docker
sudo docker compose version

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
  1. Điền Discord và email:   nano deploy/server/.env    (Ctrl+O, Enter để lưu; Ctrl+X để thoát)
  2. Chạy ứng dụng:           bash deploy/server/update.sh
EOF
