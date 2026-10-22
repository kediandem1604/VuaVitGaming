/** Ghép class Tailwind, bỏ qua giá trị rỗng/false. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
