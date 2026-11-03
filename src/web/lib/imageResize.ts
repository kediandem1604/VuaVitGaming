/**
 * Thu nhỏ ảnh ván ngay trong trình duyệt trước khi up (không cần thư viện xử lý ảnh trên server):
 *
 * - Ảnh chính: cạnh dài tối đa 1920px, mã hoá WebP chất lượng 0.85 (trình duyệt không xuất được WebP →
 *   JPEG cùng chất lượng). Ảnh đã nhỏ hơn 1920px VÀ dưới 1,5 MB → giữ nguyên file gốc. Nén lại mà to hơn
 *   file gốc (gốc vốn vừa cỡ) → cũng giữ file gốc.
 * - Ảnh nhỏ: cạnh dài tối đa 400px, WebP 0.8 (hoặc JPEG) — lưới ảnh, danh sách ván, Duyệt điểm.
 *
 * Trình duyệt không đọc được ảnh (file hỏng, định dạng lạ) → `ImageDecodeError` "Không đọc được ảnh".
 */

export const MAIN_MAX_SIDE = 1920;
export const MAIN_QUALITY = 0.85;
/** Ảnh vừa cỡ mà nhẹ hơn mức này thì up nguyên file gốc. */
export const MAIN_KEEP_MAX_BYTES = 1.5 * 1024 * 1024;
export const THUMB_MAX_SIDE = 400;
export const THUMB_QUALITY = 0.8;
export const IMAGE_DECODE_MESSAGE = 'Không đọc được ảnh';

/** Trình duyệt không giải mã / mã hoá lại được ảnh. */
export class ImageDecodeError extends Error {
  constructor() {
    super(IMAGE_DECODE_MESSAGE);
    this.name = 'ImageDecodeError';
  }
}

/** Kích thước sau khi thu cạnh dài về `maxSide` (giữ tỉ lệ, làm tròn, tối thiểu 1px); vừa rồi thì giữ nguyên. */
export function fitWithin(width: number, height: number, maxSide: number): { width: number; height: number } {
  const longSide = Math.max(width, height);
  if (longSide <= maxSide) return { width, height };
  const scale = maxSide / longSide;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}

/** Giải mã file thành ảnh vẽ được lên canvas; lỗi → `ImageDecodeError`. */
async function decode(file: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      throw new ImageDecodeError();
    }
  }
  // Trình duyệt cũ không có createImageBitmap: dùng thẻ <img>.
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new ImageDecodeError();
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Vẽ ảnh ở kích thước `width`×`height` rồi mã hoá WebP (`quality`); trình duyệt trả loại khác (không xuất
 * được WebP thì toBlob trả PNG) → vẽ lại trên nền trắng (JPEG không có kênh trong suốt) và mã hoá JPEG.
 */
async function encode(image: Decoded, width: number, height: number, quality: number): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new ImageDecodeError();
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image.source, 0, 0, width, height);
  const webp = await toBlob(canvas, 'image/webp', quality);
  if (webp && webp.type === 'image/webp') return webp;

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(image.source, 0, 0, width, height);
  const jpeg = await toBlob(canvas, 'image/jpeg', quality);
  if (!jpeg) throw new ImageDecodeError();
  return jpeg;
}

/** Ảnh chính (file gốc hoặc bản đã thu nhỏ) và ảnh nhỏ của một ảnh ván. */
export async function prepareRoundImage(file: File): Promise<{ main: Blob; thumb: Blob }> {
  const image = await decode(file);
  try {
    const fits = Math.max(image.width, image.height) <= MAIN_MAX_SIDE;
    let main: Blob = file;
    if (!fits || file.size > MAIN_KEEP_MAX_BYTES) {
      const size = fitWithin(image.width, image.height, MAIN_MAX_SIDE);
      const resized = await encode(image, size.width, size.height, MAIN_QUALITY);
      // Ảnh vốn vừa cỡ mà nén lại còn to hơn → giữ file gốc.
      main = fits && resized.size >= file.size ? file : resized;
    }
    const thumbSize = fitWithin(image.width, image.height, THUMB_MAX_SIDE);
    const thumb = await encode(image, thumbSize.width, thumbSize.height, THUMB_QUALITY);
    return { main, thumb };
  } finally {
    image.close();
  }
}
