import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { IMAGE_DECODE_MESSAGE, ImageDecodeError, fitWithin, prepareRoundImage } from '../../src/web/lib/imageResize';

// ---------------------------------------------------------------------------
// Phép tính kích thước
// ---------------------------------------------------------------------------

test('fitWithin keeps images that already fit and scales the long side down to the limit', () => {
  expect(fitWithin(1920, 1080, 1920)).toEqual({ width: 1920, height: 1080 });
  expect(fitWithin(800, 600, 1920)).toEqual({ width: 800, height: 600 });
  expect(fitWithin(3840, 2160, 1920)).toEqual({ width: 1920, height: 1080 });
  // Ảnh dọc: cạnh dài là chiều cao.
  expect(fitWithin(1080, 2400, 1920)).toEqual({ width: 864, height: 1920 });
  expect(fitWithin(2560, 1440, 400)).toEqual({ width: 400, height: 225 });
  // Làm tròn, không bao giờ về 0px.
  expect(fitWithin(5000, 3, 400)).toEqual({ width: 400, height: 1 });
  expect(fitWithin(1001, 333, 400)).toEqual({ width: 400, height: 133 });
});

// ---------------------------------------------------------------------------
// Thu nhỏ (canvas giả trong jsdom)
// ---------------------------------------------------------------------------

interface Encoded {
  type: string;
  quality: number | undefined;
  width: number;
  height: number;
}

let encoded: Encoded[];
/** Loại ảnh canvas giả "mã hoá" được — bỏ `image/webp` để giả trình duyệt không xuất được WebP. */
let supported: Set<string>;
/** Kích thước blob giả trả về theo loại ảnh. */
let blobSize: (type: string, width: number, height: number) => number;
let bitmap: { width: number; height: number; close: ReturnType<typeof vi.fn> };
let drawImage: ReturnType<typeof vi.fn>;

beforeEach(() => {
  encoded = [];
  supported = new Set(['image/png', 'image/jpeg', 'image/webp']);
  blobSize = () => 1000;
  bitmap = { width: 3840, height: 2160, close: vi.fn() };
  drawImage = vi.fn();
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => bitmap),
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => ({ drawImage, fillRect: vi.fn(), fillStyle: '', imageSmoothingEnabled: true, imageSmoothingQuality: 'low' }) as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, callback: BlobCallback, type?: string, quality?: number) {
    // Như trình duyệt thật: loại không hỗ trợ → PNG.
    const actual = type !== undefined && supported.has(type) ? type : 'image/png';
    encoded.push({ type: actual, quality, width: this.width, height: this.height });
    callback(new Blob([new Uint8Array(blobSize(actual, this.width, this.height))], { type: actual }));
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const file = (bytes: number, type = 'image/png') => new File([new Uint8Array(bytes)], 'van.png', { type });

test('a large screenshot becomes a 1920px WebP (q 0.85) plus a 400px WebP thumbnail (q 0.8)', async () => {
  const original = file(4 * 1024 * 1024);
  const { main, thumb } = await prepareRoundImage(original);
  expect(main).not.toBe(original);
  expect(main.type).toBe('image/webp');
  expect(thumb.type).toBe('image/webp');
  expect(encoded).toEqual([
    { type: 'image/webp', quality: 0.85, width: 1920, height: 1080 },
    { type: 'image/webp', quality: 0.8, width: 400, height: 225 },
  ]);
  expect(bitmap.close).toHaveBeenCalled();
});

test('a small image under 1.5 MB is uploaded as is; only the thumbnail is encoded', async () => {
  bitmap = { width: 1280, height: 720, close: vi.fn() };
  const original = file(800 * 1024);
  const { main, thumb } = await prepareRoundImage(original);
  expect(main).toBe(original);
  expect(thumb.type).toBe('image/webp');
  expect(encoded).toEqual([{ type: 'image/webp', quality: 0.8, width: 400, height: 225 }]);
});

test('an image that fits but weighs over 1.5 MB is re-encoded at its own size', async () => {
  bitmap = { width: 1600, height: 900, close: vi.fn() };
  const { main } = await prepareRoundImage(file(2 * 1024 * 1024));
  expect(main.type).toBe('image/webp');
  expect(encoded[0]).toEqual({ type: 'image/webp', quality: 0.85, width: 1600, height: 900 });
});

test('re-encoding that comes out bigger than a fitting original keeps the original', async () => {
  bitmap = { width: 1600, height: 900, close: vi.fn() };
  const original = file(2 * 1024 * 1024);
  blobSize = (type) => (type === 'image/webp' && encoded.length === 1 ? 3 * 1024 * 1024 : 1000);
  const { main } = await prepareRoundImage(original);
  expect(main).toBe(original);
});

test('a thumbnail never upscales a tiny image', async () => {
  bitmap = { width: 320, height: 180, close: vi.fn() };
  await prepareRoundImage(file(10 * 1024));
  expect(encoded).toEqual([{ type: 'image/webp', quality: 0.8, width: 320, height: 180 }]);
});

test('without WebP encoding both images fall back to JPEG with the same quality', async () => {
  supported.delete('image/webp');
  const { main, thumb } = await prepareRoundImage(file(4 * 1024 * 1024));
  expect(main.type).toBe('image/jpeg');
  expect(thumb.type).toBe('image/jpeg');
  expect(encoded.filter((e) => e.type === 'image/jpeg')).toEqual([
    { type: 'image/jpeg', quality: 0.85, width: 1920, height: 1080 },
    { type: 'image/jpeg', quality: 0.8, width: 400, height: 225 },
  ]);
});

test('an image the browser cannot decode → ImageDecodeError "Không đọc được ảnh"', async () => {
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => {
      throw new DOMException('bad', 'InvalidStateError');
    }),
  );
  const error = await prepareRoundImage(file(1000)).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ImageDecodeError);
  expect((error as Error).message).toBe(IMAGE_DECODE_MESSAGE);
  expect(IMAGE_DECODE_MESSAGE).toBe('Không đọc được ảnh');
});

test('a canvas that cannot encode (toBlob → null) is reported as unreadable too', async () => {
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback: BlobCallback) => callback(null));
  await expect(prepareRoundImage(file(4 * 1024 * 1024))).rejects.toThrow(IMAGE_DECODE_MESSAGE);
  expect(bitmap.close).toHaveBeenCalled();
});
