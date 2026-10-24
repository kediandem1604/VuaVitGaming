/**
 * Thay tạm một hàm của delegate Prisma (hay của chính client); trả về hàm khôi phục
 * (gọi trong `finally`). Không dùng `vi.spyOn`: proxy của Prisma trả descriptor không
 * có `value`, nên `restoreAllMocks` sẽ định nghĩa lại thuộc tính thành `undefined` và
 * làm hỏng delegate cho mọi test sau. Gán thẳng đi qua bẫy `set` của proxy, khôi phục
 * cũng vậy.
 */
export function patchDelegate<T extends object, K extends keyof T>(obj: T, key: K, wrap: (original: T[K]) => T[K]): () => void {
  const original = obj[key];
  obj[key] = wrap(original);
  return () => {
    obj[key] = original;
  };
}
