/**
 * Ô "Báo cáo người chơi" của form khai/sửa điểm (spec điểm role §6): ô tick, tick thì hiện bốn
 * ô chọn (`Select` xếp dọc, có ô tìm): "Người bị báo cáo" (thành viên đang hoạt động, trừ chính
 * mình), "Role của họ" (role đang bật có chỉ số phạt, nhóm theo phe), "Họ bắn trúng ai" (trừ
 * người bị báo cáo), "Phe của người bị bắn" (Ngỗng / Vịt / Phe thứ 3); dưới khung là gợi ý
 * điểm. Danh sách người lấy từ `GET /api/members/options` chỉ khi ô tick đang bật.
 *
 * Component không giữ state: form cha giữ `checked` và bản nháp (`AccusationDraft`, 0 / '' = chưa
 * chọn) để gửi hoặc không gửi `accusation` khi bấm Gửi/Lưu; `parseAccusationDraft` kiểm đủ bốn
 * trường tại chỗ với cùng lời nhắn của server. Đổi người bị báo cáo thành đúng người bị bắn đang
 * chọn thì xoá người bị bắn (server từ chối hai người trùng nhau).
 */

import { useQuery } from '@tanstack/react-query';
import type { AccusationDto, AccusationInputDto, Faction, MemberOptionDto, RoleDto } from '../../shared/api-types';
import { hasPenaltyMetric } from '../../shared/metric';
import { apiGet } from '../api';
import { useMe } from '../hooks/useMe';
import { FACTIONS, FACTION_SHORT_LABEL, FACTION_TEXT } from '../lib/factions';
import { Checkbox } from '../pages/admin/Controls';
import { QueryState } from './QueryState';
import { Select, type SelectGroup } from './Select';

const MEMBER_OPTIONS_KEY = ['members', 'options'] as const;

/** Bốn trường đang chọn; `0` (người, role) và `''` (phe) là chưa chọn. */
export interface AccusationDraft {
  accusedId: number;
  accusedRoleId: number;
  victimId: number;
  victimFaction: Faction | '';
}

export const EMPTY_ACCUSATION_DRAFT: AccusationDraft = { accusedId: 0, accusedRoleId: 0, victimId: 0, victimFaction: '' };

/** Lời báo tại chỗ khi thiếu trường — cùng chữ với `VALIDATION` của server. */
export const ACCUSATION_INCOMPLETE = 'Báo cáo cần đủ người bị báo cáo, role, người bị bắn và phe';

/** Bản nháp từ báo cáo đã gửi (form sửa lần khai còn chờ duyệt). */
export function draftFromAccusation(a: AccusationDto): AccusationDraft {
  return { accusedId: a.accused.id, accusedRoleId: a.accusedRole.id, victimId: a.victim.id, victimFaction: a.victimFaction };
}

type ParsedAccusation = { input: AccusationInputDto; error: null } | { input: null; error: string };

/** Đủ bốn trường → thân `accusation` để gửi; thiếu → lời báo tại chỗ (các luật khác do server kiểm). */
export function parseAccusationDraft(d: AccusationDraft): ParsedAccusation {
  if (d.accusedId === 0 || d.accusedRoleId === 0 || d.victimId === 0 || d.victimFaction === '') return { input: null, error: ACCUSATION_INCOMPLETE };
  return { input: { accusedId: d.accusedId, accusedRoleId: d.accusedRoleId, victimId: d.victimId, victimFaction: d.victimFaction }, error: null };
}

interface AccusationFieldsProps {
  /** Id của ô tick (các ô chọn tự đặt id). */
  id: string;
  /** Danh mục role đã tải trên trang; component tự lọc role đang bật có chỉ số phạt. */
  roles: RoleDto[];
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  draft: AccusationDraft;
  onDraftChange: (draft: AccusationDraft) => void;
}

const MEMBER_SEARCH = { label: 'Tìm người', placeholder: 'Tìm theo tên…', empty: 'Không có ai khớp' };
const ROLE_SEARCH = { label: 'Tìm role', placeholder: 'Tìm role…', empty: 'Không có role nào khớp' };
const FACTION_GROUPS: SelectGroup<Faction | ''>[] = [{ options: FACTIONS.map((faction) => ({ value: faction, label: FACTION_SHORT_LABEL[faction] })) }];

export function AccusationFields({ id, roles, checked, onCheckedChange, draft, onDraftChange }: AccusationFieldsProps) {
  return (
    <div className="flex flex-col gap-2">
      <Checkbox id={id} checked={checked} onChange={(event) => onCheckedChange(event.target.checked)} className="text-sm font-bold text-night-200">
        Báo cáo người chơi
      </Checkbox>
      {checked && <AccusationPickers roles={roles} draft={draft} onDraftChange={onDraftChange} />}
    </div>
  );
}

function AccusationPickers({ roles, draft, onDraftChange }: Pick<AccusationFieldsProps, 'roles' | 'draft' | 'onDraftChange'>) {
  const me = useMe();
  const members = useQuery({ queryKey: MEMBER_OPTIONS_KEY, queryFn: () => apiGet<MemberOptionDto[]>('/api/members/options') });

  const roleGroups: SelectGroup<number>[] = FACTIONS.map((faction) => ({
    label: FACTION_SHORT_LABEL[faction],
    labelClassName: FACTION_TEXT[faction],
    options: roles
      .filter((role) => role.active && hasPenaltyMetric(role) && role.faction === faction)
      .map((role) => ({ value: role.id, label: `${role.icon} ${role.nameVi}`, searchText: [role.nameVi, role.nameEn, role.key.replaceAll('_', ' ')] })),
  })).filter((group) => group.options.length > 0);

  const memberGroup = (list: MemberOptionDto[], exclude: number | undefined): SelectGroup<number>[] => [
    { options: list.filter((member) => member.id !== exclude).map((member) => ({ value: member.id, label: member.displayName })) },
  ];

  return (
    <div className="panel-inset flex flex-col gap-3">
      <QueryState query={members}>
        {(list) => (
          <>
            <Select
              stacked
              label="Người bị báo cáo"
              placeholder="Chọn người…"
              value={draft.accusedId}
              onChange={(accusedId) => onDraftChange({ ...draft, accusedId, victimId: draft.victimId === accusedId ? 0 : draft.victimId })}
              groups={memberGroup(list, me.data?.id)}
              search={MEMBER_SEARCH}
            />
            <Select
              stacked
              label="Role của họ"
              placeholder="Chọn role…"
              value={draft.accusedRoleId}
              onChange={(accusedRoleId) => onDraftChange({ ...draft, accusedRoleId })}
              groups={roleGroups}
              search={ROLE_SEARCH}
            />
            <Select
              stacked
              label="Họ bắn trúng ai"
              placeholder="Chọn người…"
              value={draft.victimId}
              onChange={(victimId) => onDraftChange({ ...draft, victimId })}
              groups={memberGroup(list, draft.accusedId || undefined)}
              search={MEMBER_SEARCH}
            />
            <Select
              stacked
              label="Phe của người bị bắn"
              placeholder="Chọn phe…"
              value={draft.victimFaction}
              onChange={(victimFaction) => onDraftChange({ ...draft, victimFaction })}
              groups={FACTION_GROUPS}
            />
          </>
        )}
      </QueryState>
      <p className="text-sm text-night-300">Báo cáo đúng: bạn +1 điểm, người bị báo cáo bị trừ điểm phạt của role đó.</p>
    </div>
  );
}
