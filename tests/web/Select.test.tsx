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
