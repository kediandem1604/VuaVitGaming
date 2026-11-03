# shellcheck shell=bash disable=SC2154  # `here` và `build` do script gọi đặt
# Dùng chung cho update.sh và discord-setup.sh (nạp bằng `source`, không chạy riêng).
#
# Chuẩn bị mảng `compose` (lệnh docker compose kèm đúng tag ảnh) và hàm `get_app_image`
# (tải ảnh build sẵn từ GHCR, hoặc build tại máy khi có --build).
#
# Tag ảnh: APP_TAG trong .env nếu có (ghim một bản cụ thể), không thì mã commit đang checkout —
# GitHub Actions (.github/workflows/docker.yml) đẩy ảnh với tag này cho mỗi commit của nhánh.
# Cần trước: biến `here` (thư mục deploy/server) và `build` (1 = build tại máy, 0 = tải về).

app_tag="$(grep -E '^APP_TAG=' "$here/.env" 2>/dev/null | tail -n 1 | cut -d= -f2- || true)"
[ -n "${app_tag// /}" ] || app_tag="$(git -C "$here/../.." rev-parse HEAD)"

# `sudo` xoá biến môi trường → truyền APP_TAG qua `env`. Biến trong .env (APP_IMAGE, APP_TAG)
# vẫn được compose tự đọc; biến truyền ở đây được ưu tiên hơn, nhưng cùng giá trị.
compose=(sudo env "APP_TAG=$app_tag" docker compose -f "$here/docker-compose.yml")
if [ "$build" = 1 ]; then
  compose+=(-f "$here/docker-compose.build.yml")
fi

get_app_image() {
  if [ "$build" = 1 ]; then
    echo "==> Build ảnh ứng dụng tại máy (chậm: 5–35 phút tuỳ máy)"
    "${compose[@]}" build app
    return
  fi
  echo "==> Tải ảnh ứng dụng (tag ${app_tag:0:12})"
  if ! "${compose[@]}" pull app; then
    cat >&2 <<EOF

Không tải được ảnh ứng dụng cho commit ${app_tag:0:12}. Thường do một trong hai:
  - GitHub chưa build xong commit này (mất khoảng 5–10 phút sau mỗi lần đẩy code). Xem tab
    Actions → "Docker image" của repo trên GitHub; khi có dấu ✓ xanh thì chạy lại lệnh này.
  - Package trên GitHub (ghcr.io) còn để riêng tư: README mục 6C.4, "Ảnh ứng dụng trên GitHub".
Hoặc build ngay trên máy (chậm, 15–35 phút trên e2-micro): thêm --build vào lệnh vừa chạy.
EOF
    exit 1
  fi
}
