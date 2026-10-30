import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { Select, type SelectGroup } from '../../src/web/components/Select';

/**
 * Ô chọn tự làm (listbox kiểu "select-only combobox" có ô tìm): mở/đóng bằng chuột và phím,
 * chọn bằng Enter/click, Esc trả focus về nút, tìm không dấu, nhóm có tiêu đề, `aria-*` đúng,
 * bấm ra ngoài thì đóng.
 */

const GROUPS: SelectGroup<number>[] = [
  {
    label: 'Ngỗng',
    options: [
      { value: 1, label: '🪿 Ngỗng', searchText: ['Ngỗng', 'goose'] },
      { value: 6, label: '🍁 Người Canada', searchText: ['Người Canada', 'canadian'] },
    ],
  },
  {
    label: 'Vịt',
    options: [
      { value: 61, label: '⚔️ Kiếm sĩ', searchText: ['Kiếm sĩ', 'swordsman'] },
      { value: 50, label: '🗡️ Ám sát', searchText: ['Ám sát', 'assassin'] },
    ],
  },
  { label: 'Phe thứ 3', options: [{ value: 70, label: '🔧 Kỹ sư', searchText: ['Kỹ sư', 'engineer'] }] },
];

const SEASONS: SelectGroup<string>[] = [
  {
    options: [
      { value: '2026-10', label: 'Tháng 10/2026' },
      { value: '2026-09', label: 'Tháng 9/2026 (đã chốt)' },
      { value: '2026-08', label: 'Tháng 8/2026 (đã chốt)' },
    ],
  },
];

const combobox = (name: string) => screen.getByRole('combobox', { name });
const listbox = () => screen.getByRole('listbox');

function renderRoles(onChange = vi.fn<(value: number) => void>(), value = 1) {
  render(<Select label="Role" value={value} onChange={onChange} groups={GROUPS} search={{ label: 'Tìm role', placeholder: 'Tìm role…', empty: 'Không có role nào khớp' }} />);
  return onChange;
}

function renderSeasons(onChange = vi.fn<(value: string) => void>()) {
  render(<Select label="Mùa" value="2026-09" onChange={onChange} groups={SEASONS} />);
  return onChange;
}

afterEach(cleanup);

test('closed: the trigger is a combobox named by the label, showing the selected option, with no listbox', () => {
  renderRoles();
  const trigger = combobox('Role');
  expect(trigger).toHaveTextContent('🪿 Ngỗng');
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(trigger).toHaveAttribute('aria-haspopup', 'listbox');
  expect(screen.queryByRole('listbox')).toBeNull();
});

test('click opens a listbox with grouped options, the selected one marked; click again closes', () => {
  renderRoles();
  fireEvent.click(combobox('Role'));

  expect(combobox('Role')).toHaveAttribute('aria-expanded', 'true');
  const list = listbox();
  expect(list).toHaveAccessibleName('Role');
  const groupName = (group: HTMLElement) => document.getElementById(group.getAttribute('aria-labelledby') ?? '')?.textContent;
  expect(within(list).getAllByRole('group').map(groupName)).toEqual(['Ngỗng', 'Vịt', 'Phe thứ 3']);
  expect(within(screen.getByRole('group', { name: 'Vịt' })).getAllByRole('option').map((option) => option.textContent)).toEqual(['⚔️ Kiếm sĩ', '🗡️ Ám sát']);

  const selected = screen.getByRole('option', { name: '🪿 Ngỗng' });
  expect(selected).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('option', { name: '⚔️ Kiếm sĩ' })).toHaveAttribute('aria-selected', 'false');
  // Dòng đang chọn là dòng được trỏ sẵn khi mở.
  expect(combobox('Role')).toHaveAttribute('aria-controls', list.id);

  fireEvent.click(combobox('Role'));
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(combobox('Role')).toHaveAttribute('aria-expanded', 'false');
});

test('clicking an option calls onChange with its value and closes', () => {
  const onChange = renderRoles();
  fireEvent.click(combobox('Role'));
  fireEvent.click(screen.getByRole('option', { name: '⚔️ Kiếm sĩ' }));

  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenCalledWith(61);
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(combobox('Role')).toHaveFocus();
});

test('ungrouped select: ArrowDown opens with the selected option active; arrows/Home/End move; Enter picks; focus stays on the trigger', () => {
  const onChange = renderSeasons();
  const trigger = combobox('Mùa');
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });

  expect(screen.queryByRole('group')).toBeNull();
  expect(screen.queryByRole('textbox')).toBeNull();
  const active = () => document.getElementById(trigger.getAttribute('aria-activedescendant') ?? '');
  expect(active()).toHaveTextContent('Tháng 9/2026 (đã chốt)');
  expect(trigger).toHaveFocus();

  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  expect(active()).toHaveTextContent('Tháng 8/2026 (đã chốt)');
  // Không vòng lại ở cuối.
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  expect(active()).toHaveTextContent('Tháng 8/2026 (đã chốt)');
  fireEvent.keyDown(trigger, { key: 'Home' });
  expect(active()).toHaveTextContent('Tháng 10/2026');
  fireEvent.keyDown(trigger, { key: 'End' });
  expect(active()).toHaveTextContent('Tháng 8/2026 (đã chốt)');
  fireEvent.keyDown(trigger, { key: 'ArrowUp' });
  expect(active()).toHaveTextContent('Tháng 9/2026 (đã chốt)');
  fireEvent.keyDown(trigger, { key: 'ArrowUp' });

  fireEvent.keyDown(trigger, { key: 'Enter' });
  expect(onChange).toHaveBeenCalledWith('2026-10');
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(trigger).toHaveFocus();
});

test('ungrouped select: typing jumps to the first matching option, accent-insensitively', () => {
  renderSeasons();
  const trigger = combobox('Mùa');
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  fireEvent.keyDown(trigger, { key: 't' });
  fireEvent.keyDown(trigger, { key: 'h' });
  fireEvent.keyDown(trigger, { key: 'a' });
  fireEvent.keyDown(trigger, { key: 'n' });
  fireEvent.keyDown(trigger, { key: 'g' });
  fireEvent.keyDown(trigger, { key: ' ' });
  fireEvent.keyDown(trigger, { key: '8' });
  const active = document.getElementById(trigger.getAttribute('aria-activedescendant') ?? '');
  expect(active).toHaveTextContent('Tháng 8/2026 (đã chốt)');
});

test('Escape closes without changing the value and returns focus to the trigger', () => {
  const onChange = renderRoles();
  fireEvent.click(combobox('Role'));
  const search = screen.getByRole('textbox', { name: 'Tìm role' });
  expect(search).toHaveFocus();
  fireEvent.keyDown(search, { key: 'ArrowDown' });
  fireEvent.keyDown(search, { key: 'Escape' });

  expect(onChange).not.toHaveBeenCalled();
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(combobox('Role')).toHaveFocus();
});

test('searchable: the search box filters accent- and case-insensitively, arrows walk the matches, Enter picks', () => {
  const onChange = renderRoles();
  fireEvent.click(combobox('Role'));
  const search = screen.getByRole('textbox', { name: 'Tìm role' });
  expect(search).toHaveAttribute('placeholder', 'Tìm role…');
  expect(search).toHaveAttribute('aria-controls', listbox().id);

  fireEvent.change(search, { target: { value: 'KY SU' } });
  expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['🔧 Kỹ sư']);
  // Chỉ còn nhóm có kết quả.
  expect(screen.getAllByRole('group')).toHaveLength(1);
  // Dòng khớp đầu tiên được trỏ sẵn.
  expect(document.getElementById(search.getAttribute('aria-activedescendant') ?? '')).toHaveTextContent('🔧 Kỹ sư');

  fireEvent.change(search, { target: { value: 'sword' } });
  expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['⚔️ Kiếm sĩ']);

  fireEvent.change(search, { target: { value: 'xyz' } });
  expect(screen.queryByRole('option')).toBeNull();
  expect(screen.getByText('Không có role nào khớp')).toBeInTheDocument();
  fireEvent.keyDown(search, { key: 'Enter' });
  expect(onChange).not.toHaveBeenCalled();
  expect(listbox()).toBeInTheDocument();

  // "an" khớp "Người Canada" (canadian) và "Kiếm sĩ" (swordsman), không khớp "Ám sát" (assassin).
  fireEvent.change(search, { target: { value: 'an' } });
  expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['🍁 Người Canada', '⚔️ Kiếm sĩ']);
  fireEvent.keyDown(search, { key: 'ArrowDown' });
  fireEvent.keyDown(search, { key: 'Enter' });
  expect(onChange).toHaveBeenCalledWith(61);
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(combobox('Role')).toHaveFocus();
});

test('reopening clears the previous search', () => {
  renderRoles();
  fireEvent.click(combobox('Role'));
  fireEvent.change(screen.getByRole('textbox', { name: 'Tìm role' }), { target: { value: 'ky' } });
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Tìm role' }), { key: 'Escape' });
  fireEvent.click(combobox('Role'));
  expect(screen.getByRole('textbox', { name: 'Tìm role' })).toHaveValue('');
  expect(screen.getAllByRole('option')).toHaveLength(5);
});

test('pointer down outside closes; inside the popup does not', () => {
  renderRoles();
  fireEvent.click(combobox('Role'));
  fireEvent.pointerDown(listbox());
  expect(listbox()).toBeInTheDocument();

  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole('listbox')).toBeNull();
});

test('hovering an option makes it the active descendant', () => {
  renderRoles();
  fireEvent.click(combobox('Role'));
  const search = screen.getByRole('textbox', { name: 'Tìm role' });
  const option = screen.getByRole('option', { name: '🗡️ Ám sát' });
  fireEvent.pointerMove(option);
  expect(search).toHaveAttribute('aria-activedescendant', option.id);
});

test('the trigger reflects a value changed from outside', () => {
  const onChange = vi.fn();
  const { rerender } = render(<Select label="Mùa" value="2026-09" onChange={onChange} groups={SEASONS} />);
  expect(combobox('Mùa')).toHaveTextContent('Tháng 9/2026 (đã chốt)');
  rerender(<Select label="Mùa" value="2026-10" onChange={onChange} groups={SEASONS} />);
  expect(combobox('Mùa')).toHaveTextContent('Tháng 10/2026');
});

test('Space on a closed trigger opens the list (keydown, not the native click) — with and without a search box', () => {
  renderSeasons();
  const season = combobox('Mùa');
  season.focus();
  const spaceDown = fireEvent.keyDown(season, { key: ' ' });
  // Đã xử lý ở keydown → chặn mặc định; `keyup` sau đó không bị chặn nên không ảnh hưởng gì khác.
  expect(spaceDown).toBe(false);
  expect(listbox()).toBeInTheDocument();
  expect(season).toHaveAttribute('aria-expanded', 'true');
  expect(fireEvent.keyUp(season, { key: ' ' })).toBe(true);
  expect(listbox()).toBeInTheDocument();
  cleanup();

  renderRoles();
  const role = combobox('Role');
  role.focus();
  expect(fireEvent.keyDown(role, { key: ' ' })).toBe(false);
  expect(listbox()).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Tìm role' })).toHaveFocus();
});

test('Space picks the active option, and the click the browser fires on key release does not reopen the list', () => {
  const onChange = renderSeasons();
  const trigger = combobox('Mùa');
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  fireEvent.keyDown(trigger, { key: ' ' });
  expect(onChange).toHaveBeenCalledWith('2026-08');
  expect(screen.queryByRole('listbox')).toBeNull();
  // Thả Space: trình duyệt sẽ phát `click` trên nút — phải bị chặn để khung không mở lại.
  expect(fireEvent.keyUp(trigger, { key: ' ' })).toBe(false);
  expect(screen.queryByRole('listbox')).toBeNull();
  // Lần thả Space tiếp theo (không chọn gì) không còn bị chặn.
  expect(fireEvent.keyUp(trigger, { key: ' ' })).toBe(true);
});

test('pointer down on non-focusable popup chrome is default-prevented so focus (and the list) stay; the search input is not', () => {
  renderRoles();
  fireEvent.click(combobox('Role'));
  const search = screen.getByRole('textbox', { name: 'Tìm role' });
  const heading = screen.getByText('Vịt');
  expect(fireEvent.pointerDown(heading)).toBe(false);
  expect(fireEvent.pointerDown(search.parentElement as HTMLElement)).toBe(false);
  expect(fireEvent.pointerDown(search)).toBe(true);
  fireEvent.change(search, { target: { value: 'xyz' } });
  expect(fireEvent.pointerDown(screen.getByText('Không có role nào khớp'))).toBe(false);
  expect(listbox()).toBeInTheDocument();
});

test('the selected option keeps its gold tint even while it is the active (hovered) row', () => {
  renderRoles();
  fireEvent.click(combobox('Role'));
  const selected = screen.getByRole('option', { name: '🪿 Ngỗng' });
  // Mở ra thì dòng đang chọn cũng là dòng đang trỏ.
  expect(selected.className).toContain('bg-gold/25');
  expect(selected.className).not.toContain('bg-night-700');
  fireEvent.pointerMove(screen.getByRole('option', { name: '⚔️ Kiếm sĩ' }));
  expect(selected.className).toContain('bg-gold/15');
  expect(screen.getByRole('option', { name: '⚔️ Kiếm sĩ' }).className).toContain('bg-night-700');
});

test('the popup gets an inline max-height sized to the space available in its direction (capped at 60vh)', () => {
  renderSeasons();
  const trigger = combobox('Mùa');
  const rect = (top: number, bottom: number) => ({ top, bottom, left: 0, right: 200, width: 200, height: 40, x: 0, y: top, toJSON: () => ({}) });
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });

  // Nút sát đáy màn hình 800px → bật lên trên; phía trên rộng → chạm trần 60vh = 480px.
  const spy = vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue(rect(700, 740));
  fireEvent.click(trigger);
  let popup = listbox().parentElement as HTMLElement;
  expect(popup.className).toContain('bottom-full');
  expect(popup.style.maxHeight).toBe('480px');
  fireEvent.keyDown(trigger, { key: 'Escape' });

  // Nút ở giữa, phía dưới còn 300px → mở xuống, cao tối đa dưới 300px (trừ lề).
  spy.mockReturnValue(rect(460, 500));
  fireEvent.click(trigger);
  popup = listbox().parentElement as HTMLElement;
  expect(popup.className).toContain('top-full');
  const px = parseFloat(popup.style.maxHeight);
  expect(px).toBeGreaterThan(240);
  expect(px).toBeLessThan(300);
});

test('with no option matching the value, the trigger shows the placeholder in muted text (and nothing without one)', () => {
  render(<Select label="Người bị báo cáo" value={0} onChange={vi.fn()} groups={GROUPS} placeholder="Chọn người…" />);
  const trigger = combobox('Người bị báo cáo');
  expect(trigger).toHaveTextContent('Chọn người…');
  expect(within(trigger).getByText('Chọn người…').className).toContain('text-night-300');
  cleanup();

  render(<Select label="Role" value={0} onChange={vi.fn()} groups={GROUPS} />);
  expect(combobox('Role')).toHaveTextContent('');
});

test('stacked: the label sits above a full-width trigger whose popup spans the trigger on every breakpoint', () => {
  render(<Select label="Role của họ" value={61} onChange={vi.fn()} groups={GROUPS} stacked />);
  const trigger = combobox('Role của họ');
  const root = trigger.closest('div')?.parentElement as HTMLElement;
  expect(root.className).toContain('flex-col');
  expect(root.className).not.toContain('items-center');
  expect(trigger.className).toContain('w-full');
  expect(trigger.className).not.toContain('sm:w-auto');
  fireEvent.click(trigger);
  const popup = listbox().parentElement as HTMLElement;
  expect(popup.className).not.toContain('sm:w-max');
});
