/**
 * Ô chọn tự làm dùng chung (pattern WAI-ARIA "select-only combobox", tuỳ chọn thêm ô tìm) —
 * menu gốc `<select>` không bo góc/đổi màu được nên Bảng xếp hạng và ô chọn mùa dùng cái này.
 *
 * Nút kích hoạt kiểu `field` (bo góc, mũi tên ▾) mang `role="combobox"`; bấm/Enter/Space/↓
 * mở khung `popover` bo góc có bóng đổ, cuộn trong. Dòng đang chọn nền vàng nhạt + dấu ✓,
 * dòng đang trỏ (rê chuột/phím) sáng lên. Phím: ↑/↓/Home/End di chuyển, Enter (và Space khi
 * không gõ tìm) chọn, Esc đóng và trả focus về nút; bấm ra ngoài hay Tab ra khỏi ô thì đóng.
 * Space/↑/↓ mở ngay ở keydown (Enter để nút tự phát `click`). Khung cao tối đa 60vh nhưng không
 * quá chỗ trống còn lại theo hướng mở (trừ lề) để không tràn màn hình hay chui dưới thanh đầu
 * trang dính; gần mép dưới mà phía trên rộng hơn thì bật lên trên. Trên điện thoại khung rộng
 * bằng nút và dòng cao ≥ 44px.
 *
 * Nhóm (`SelectGroup.label`) có tiêu đề dính khi cuộn. Không có ô tìm thì gõ chữ nhảy tới dòng
 * đầu tiên bắt đầu bằng chuỗi gõ (không phân biệt dấu/hoa thường, bộ đệm xoá sau 600ms). Có ô
 * tìm (`search`) thì focus vào ô đó khi mở, gõ để lọc (khớp `label` hoặc `searchText`, không
 * phân biệt dấu/hoa thường qua `normalizeText` dùng chung với `RolePicker`), nhóm không còn
 * dòng nào thì ẩn, không khớp gì thì ghi `search.empty`.
 *
 * `aria-activedescendant` đặt trên phần tử đang giữ focus (nút, hoặc ô tìm khi mở) để trình
 * đọc màn hình đọc dòng đang trỏ mà focus DOM không rời đi; danh sách lấy tên từ nhãn.
 *
 * Trong form (ô báo cáo người chơi ở trang Khai điểm) dùng `stacked`: nhãn trên, nút rộng hết ô,
 * khung rộng bằng nút; `placeholder` là chữ mờ ở nút khi chưa chọn gì (`value` không khớp dòng nào).
 */

import { useEffect, useId, useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { normalizeText } from '../../shared/text';
import { cx } from '../lib/cx';

export interface SelectOption<T extends string | number> {
  value: T;
  /** Chữ hiện ở nút và trong dòng; cũng dùng để tìm. */
  label: string;
  /** Chuỗi khớp thêm khi tìm (tên Anh, key…) ngoài `label`. */
  searchText?: string[];
}

export interface SelectGroup<T extends string | number> {
  /** Tiêu đề nhóm; bỏ trống thì nhóm không có tiêu đề (ô chọn không nhóm). */
  label?: string;
  /** Class thêm cho tiêu đề nhóm (vd màu phe). */
  labelClassName?: string;
  options: SelectOption<T>[];
}

export interface SelectSearch {
  /** Nhãn ẩn của ô tìm cho trình đọc màn hình. */
  label: string;
  placeholder: string;
  /** Chữ hiện khi không dòng nào khớp. */
  empty: string;
}

interface SelectProps<T extends string | number> {
  /** Nhãn hiện bên trái nút ("Role", "Mùa"); cũng là tên của combobox và listbox. */
  label: string;
  value: T;
  onChange: (value: T) => void;
  groups: SelectGroup<T>[];
  /** Có ô tìm trong khung. */
  search?: SelectSearch;
  /** Chữ mờ hiện ở nút khi `value` chưa khớp dòng nào (ô chọn trong form chưa chọn gì). */
  placeholder?: string;
  /**
   * Bố cục xếp dọc cho form: nhãn (kiểu nhãn form) nằm trên, nút rộng hết ô và khung rộng bằng nút
   * ở mọi cỡ màn hình. Mặc định (hàng ngang) dành cho thanh lọc như Bảng xếp hạng.
   */
  stacked?: boolean;
  /** Class cho phần tử gốc (hàng nhãn + nút). */
  className?: string;
  /** Class thêm cho nút kích hoạt (vd bề rộng). */
  triggerClassName?: string;
}

/** Thời gian bộ đệm gõ-để-nhảy (khi không có ô tìm) tự xoá. */
const TYPEAHEAD_RESET_MS = 600;
/** Khung mở xuống dưới cần ít nhất chừng này; thiếu mà phía trên rộng hơn thì bật lên trên. */
const MIN_SPACE_BELOW_PX = 240;
/** Khoảng chừa giữa khung và mép màn hình (thanh đầu trang dính cao ~3.5rem khi mở lên trên). */
const POPUP_MARGIN_PX = 16;
const STICKY_HEADER_PX = 56;
/** Khung không cao quá chừng này phần màn hình. */
const MAX_HEIGHT_VH = 0.6;

/**
 * Chiều cao tối đa của khung theo hướng mở: min(60vh, chỗ trống còn lại − lề). Mở lên trên còn
 * trừ thanh đầu trang dính để khung không chui dưới nó.
 */
export function popupMaxHeight(trigger: DOMRect, viewportHeight: number, flipUp: boolean): number {
  const room = flipUp ? trigger.top - STICKY_HEADER_PX : viewportHeight - trigger.bottom;
  return Math.max(0, Math.floor(Math.min(viewportHeight * MAX_HEIGHT_VH, room - POPUP_MARGIN_PX)));
}

/** Dòng phẳng kèm vị trí nhóm, để đi phím theo thứ tự hiển thị. */
interface FlatOption<T extends string | number> {
  option: SelectOption<T>;
  groupIndex: number;
}

function optionMatches<T extends string | number>(option: SelectOption<T>, query: string): boolean {
  return [option.label, ...(option.searchText ?? [])].some((text) => normalizeText(text).includes(query));
}

export function Select<T extends string | number>({ label, value, onChange, groups, search, placeholder, stacked = false, className, triggerClassName }: SelectProps<T>) {
  const id = useId();
  const labelId = `${id}-label`;
  const listId = `${id}-list`;
  const optionId = (index: number) => `${id}-opt-${index}`;

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const typeahead = useRef({ buffer: '', timer: 0 });
  // Space vừa chọn một dòng ở keydown: thả phím trình duyệt sẽ phát `click` trên nút → chặn ở keyup.
  const spacePicked = useRef(false);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [flipUp, setFlipUp] = useState(false);
  const [alignRight, setAlignRight] = useState(false);
  const [maxHeight, setMaxHeight] = useState<number | undefined>(undefined);

  const allOptions = groups.flatMap((group) => group.options);
  const selected = allOptions.find((option) => option.value === value);

  // Danh sách đang hiện: lọc theo ô tìm (nếu có), giữ thứ tự nhóm.
  const normalisedQuery = search ? normalizeText(query) : '';
  const visible: FlatOption<T>[] = groups.flatMap((group, groupIndex) =>
    group.options
      .filter((option) => normalisedQuery === '' || optionMatches(option, normalisedQuery))
      .map((option) => ({ option, groupIndex })),
  );
  const activeOption = visible[active]?.option;
  const activeId = open && activeOption ? optionId(active) : undefined;

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };

  const openList = () => {
    // Mở với dòng đang chọn được trỏ sẵn; ô tìm và bộ đệm gõ-để-nhảy xoá sạch.
    setQuery('');
    typeahead.current.buffer = '';
    const index = Math.max(0, allOptions.findIndex((option) => option.value === value));
    setActive(index);
    const trigger = triggerRef.current;
    if (trigger) {
      const rect = trigger.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom;
      const up = below < MIN_SPACE_BELOW_PX && rect.top > below;
      setFlipUp(up);
      // Không có bố cục thật (jsdom trả rect 0×0) thì không giới hạn chiều cao.
      setMaxHeight(rect.width === 0 && rect.height === 0 ? undefined : popupMaxHeight(rect, window.innerHeight, up));
      // Nút ở nửa phải màn hình (vd ô chọn mùa ở góc phải đầu trang): khung bám mép phải để không tràn ra ngoài.
      setAlignRight(rect.left + rect.width / 2 > window.innerWidth / 2);
    }
    setOpen(true);
  };

  const choose = (option: SelectOption<T>) => {
    if (option.value !== value) onChange(option.value);
    close(true);
  };

  // Có ô tìm: focus vào ô tìm ngay khi khung mở (phụ thuộc vào có/không, không phải object `search`).
  const hasSearch = search !== undefined;
  useEffect(() => {
    if (open && hasSearch) searchRef.current?.focus();
  }, [open, hasSearch]);

  // Huỷ hẹn giờ của bộ đệm gõ-để-nhảy khi gỡ component.
  useEffect(() => () => window.clearTimeout(typeahead.current.timer), []);

  // Cuộn dòng đang trỏ vào tầm nhìn — chỉ cuộn trong danh sách, không dùng `scrollIntoView`
  // vì nó cuộn cả trang khi khung thò ra ngoài màn hình. Tiêu đề nhóm dính che mép trên nên
  // trừ chiều cao của nó khi cuộn lên.
  useLayoutEffect(() => {
    const list = listRef.current;
    const row = activeId ? document.getElementById(activeId) : null;
    if (!list || !row) return;
    const header = row.closest('[role="group"]')?.firstElementChild;
    const top = row.offsetTop - (header instanceof HTMLElement ? header.offsetHeight : 0);
    const bottom = row.offsetTop + row.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
  }, [activeId]);

  // Bấm ra ngoài thì đóng (không kéo focus về nút).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  /** Gõ chữ khi không có ô tìm: nhảy tới dòng đầu bắt đầu bằng chuỗi đã gõ. */
  const typeToJump = (key: string) => {
    const state = typeahead.current;
    window.clearTimeout(state.timer);
    state.buffer += key;
    state.timer = window.setTimeout(() => (state.buffer = ''), TYPEAHEAD_RESET_MS);
    const wanted = normalizeText(state.buffer);
    const index = visible.findIndex(({ option }) => normalizeText(option.label).startsWith(wanted));
    if (index >= 0) setActive(index);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const { key } = event;
    if (!open) {
      // Space mở ngay ở keydown: không dựa vào `click` nút phát khi thả phím (keyup bị chặn khi
      // Space vừa chọn xong thì `click` cũng mất). Enter để nút tự phát `click` → mở ở `onClick`.
      if (key === 'ArrowDown' || key === 'ArrowUp' || key === ' ') {
        event.preventDefault();
        openList();
      }
      return;
    }

    const last = visible.length - 1;
    switch (key) {
      case 'ArrowDown':
        event.preventDefault();
        setActive((i) => Math.min(i + 1, last));
        return;
      case 'ArrowUp':
        event.preventDefault();
        setActive((i) => Math.max(i - 1, 0));
        return;
      case 'Home':
        event.preventDefault();
        setActive(0);
        return;
      case 'End':
        event.preventDefault();
        setActive(last);
        return;
      case 'Escape':
        event.preventDefault();
        close(true);
        return;
      case 'Tab':
        // Tab đi tiếp bình thường; chỉ đóng khung.
        setOpen(false);
        return;
      case 'Enter':
        event.preventDefault();
        if (activeOption) choose(activeOption);
        return;
      case ' ':
        if (search) return; // dấu cách thuộc chuỗi tìm
        event.preventDefault();
        // Đang gõ-để-nhảy thì dấu cách là một phần chuỗi ("thang 8"); không thì chọn.
        if (typeahead.current.buffer !== '') typeToJump(' ');
        else if (activeOption) {
          spacePicked.current = true;
          choose(activeOption);
        }
        return;
      default:
        if (!search && key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault();
          typeToJump(key);
        }
    }
  };

  // Chỉ khi Space vừa chọn một dòng: chặn `click` nút phát lúc thả phím, khỏi mở lại khung.
  const onTriggerKeyUp = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === ' ' && spacePicked.current) {
      spacePicked.current = false;
      event.preventDefault();
    }
  };

  // Bấm vào phần không nhận focus trong khung (viền ô tìm, tiêu đề nhóm, chữ "không khớp"):
  // chặn mặc định để focus không rời nút/ô tìm → `onBlur` không đóng khung. Ô tìm thì để nguyên.
  const onPopupPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.target !== searchRef.current) event.preventDefault();
  };

  // Tab/shift+Tab rời khỏi cả ô (nút lẫn khung) thì đóng.
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (open && !rootRef.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
  };

  // Chỉ số phẳng để nối id dòng với vị trí trong `visible`.
  let flatIndex = -1;

  return (
    <div ref={rootRef} className={cx('flex text-sm', stacked ? 'flex-col gap-1' : 'items-center gap-2', className)} onBlur={onBlur}>
      {/* Bấm nhãn thì focus nút, như nhãn của `<select>` gốc. */}
      <span id={labelId} className={cx('shrink-0 font-bold', stacked ? 'text-night-200' : 'text-night-300')} onClick={() => triggerRef.current?.focus()}>
        {label}
      </span>
      <div className={cx('relative min-w-0', !stacked && 'flex-1 sm:flex-none')}>
        <button
          ref={triggerRef}
          type="button"
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-labelledby={labelId}
          aria-activedescendant={search ? undefined : activeId}
          className={cx('field flex w-full items-center justify-between gap-2 py-1.5 pr-2 text-left', !stacked && 'sm:w-auto', open && 'border-gold', triggerClassName)}
          onClick={() => (open ? close(true) : openList())}
          onKeyDown={onKeyDown}
          onKeyUp={onTriggerKeyUp}
        >
          {selected ? <span className="min-w-0 truncate">{selected.label}</span> : <span className="min-w-0 truncate text-night-300">{placeholder ?? ''}</span>}
          <Chevron open={open} />
        </button>

        {open && (
          <div
            className={cx(
              // Điện thoại (và bố cục dọc): rộng bằng nút; hàng ngang từ `sm` rộng theo nội dung nhưng
              // không hẹp hơn nút và không quá 20rem, bám mép trái hoặc phải của nút tuỳ nút ở nửa nào màn hình.
              'popover absolute left-0 right-0 z-20 flex flex-col overflow-hidden',
              !stacked && 'sm:w-max sm:max-w-80 sm:min-w-full',
              !stacked && (alignRight ? 'sm:left-auto' : 'sm:right-auto'),
              flipUp ? 'bottom-full mb-1' : 'top-full mt-1',
            )}
            // Tính lúc mở (xem `popupMaxHeight`).
            style={maxHeight !== undefined ? { maxHeight } : undefined}
            onPointerDown={onPopupPointerDown}
          >
            {search && (
              <div className="shrink-0 border-b-2 border-night-700 p-2">
                <input
                  ref={searchRef}
                  type="text"
                  aria-label={search.label}
                  aria-autocomplete="list"
                  aria-controls={listId}
                  aria-activedescendant={activeId}
                  autoComplete="off"
                  placeholder={search.placeholder}
                  className="field py-1.5"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setActive(0);
                  }}
                  onKeyDown={onKeyDown}
                />
              </div>
            )}
            {visible.length === 0 && search && <p className="px-3 py-2 text-night-300">{search.empty}</p>}
            {/* `relative` để `offsetTop` của dòng tính từ danh sách (cuộn trong ở trên). */}
            <ul ref={listRef} id={listId} role="listbox" aria-labelledby={labelId} className="relative min-h-0 flex-1 overflow-y-auto py-1 [scrollbar-width:thin]">
              {groups.map((group, groupIndex) => {
                const rows = visible.filter((row) => row.groupIndex === groupIndex);
                if (rows.length === 0) return null;
                const headingId = `${id}-group-${groupIndex}`;
                const items = rows.map(({ option }) => {
                  flatIndex += 1;
                  const index = flatIndex;
                  return (
                    <OptionRow
                      key={String(option.value)}
                      id={optionId(index)}
                      label={option.label}
                      selected={option.value === value}
                      active={index === active}
                      onHover={() => setActive(index)}
                      onPick={() => choose(option)}
                    />
                  );
                });
                if (group.label === undefined) return items;
                return (
                  <li key={headingId} role="group" aria-labelledby={headingId}>
                    {/* Tiêu đề dính khi cuộn; nền `night-800` che dòng trượt bên dưới. */}
                    <div id={headingId} role="presentation" className={cx('sticky top-0 z-10 bg-night-800 px-3 py-1 text-xs font-extrabold tracking-wide uppercase', group.labelClassName ?? 'text-night-300')}>
                      {group.label}
                    </div>
                    <ul role="presentation">{items}</ul>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

interface OptionRowProps {
  id: string;
  label: ReactNode;
  selected: boolean;
  active: boolean;
  onHover: () => void;
  onPick: () => void;
}

/**
 * Một dòng: cao ≥ 44px trên điện thoại (từ `sm` 36px), dòng đang chọn nền vàng nhạt + ✓ (đậm
 * hơn khi cũng đang trỏ, để màu chọn luôn thấy), dòng đang trỏ khác nền `night-700`.
 * `onPointerDown` chặn mặc định để focus không rời ô tìm/nút trước khi `click` tới.
 */
function OptionRow({ id, label, selected, active, onHover, onPick }: OptionRowProps) {
  return (
    <li
      id={id}
      role="option"
      aria-selected={selected}
      className={cx(
        'flex min-h-11 cursor-pointer items-center gap-2 px-3 py-1.5 text-base text-white sm:min-h-9',
        selected ? cx('font-bold', active ? 'bg-gold/25' : 'bg-gold/15') : active && 'bg-night-700',
      )}
      onPointerMove={onHover}
      onPointerDown={(event) => event.preventDefault()}
      onClick={onPick}
    >
      <span className="min-w-0 flex-1 break-words">{label}</span>
      {/* Dấu ✓ chỉ trang trí: `aria-selected` đã nói dòng này đang chọn. */}
      {selected && (
        <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4 shrink-0 text-gold" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="m4 10.5 4 4 8-9" />
        </svg>
      )}
    </li>
  );
}

/** Mũi tên ▾ bên phải nút; lật lên khi khung đang mở. */
function Chevron({ open }: { open: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className={cx('size-4 shrink-0 text-night-300 transition-transform', open && 'rotate-180')} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="m5 8 5 5 5-5" />
    </svg>
  );
}
