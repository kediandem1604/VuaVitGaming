/**
 * Bốn ô chọn của form "Báo cáo người chơi" (tab riêng ở trang Khai điểm, spec 2026-10-31 §B; trước
 * đây là ô tick trong form khai điểm): `Select` xếp dọc, có ô tìm — "Người bị báo cáo" (thành viên
 * đang hoạt động, trừ chính mình), "Role của họ" (role đang bật có chỉ số phạt, nhóm theo phe), "Họ
 * bắn trúng ai" (trừ người bị báo cáo), "Phe của người bị bắn" (Ngỗng / Vịt / Phe thứ 3). Danh sách
 * người lấy từ `GET /api/members/options`.
 *
 * Component không giữ state: form cha giữ bản nháp (`AccusationDraft`, 0 / '' = chưa chọn);
 * `parseAccusationDraft` kiểm đủ bốn trường tại chỗ với cùng lời nhắn của server. Đổi người bị báo
 * cáo thành đúng người bị bắn đang chọn thì xoá người bị bắn (server từ chối hai người trùng nhau).
 */

import { useQuery } from '@tanstack/react-query';
import type { AccusationInputDto, Faction, MemberOptionDto, RoleDto } from '../../shared/api-types';
import { hasPenaltyMetric } from '../../shared/metric';
import { useMe } from '../hooks/useMe';
import { FACTIONS, FACTION_SHORT_LABEL, FACTION_TEXT } from '../lib/factions';
import { memberOptionsQuery } from '../lib/queries';
import { QueryState } from './QueryState';
import { Select, type SelectGroup } from './Select';

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

type ParsedAccusation = { input: AccusationInputDto; error: null } | { input: null; error: string };

/** Đủ bốn trường → bốn trường để gửi; thiếu → lời báo tại chỗ (các luật khác do server kiểm). */
export function parseAccusationDraft(d: AccusationDraft): ParsedAccusation {
  if (d.accusedId === 0 || d.accusedRoleId === 0 || d.victimId === 0 || d.victimFaction === '') return { input: null, error: ACCUSATION_INCOMPLETE };
  return { input: { accusedId: d.accusedId, accusedRoleId: d.accusedRoleId, victimId: d.victimId, victimFaction: d.victimFaction }, error: null };
}

interface AccusationPickersProps {
  /** Danh mục role đã tải trên trang; component tự lọc role đang bật có chỉ số phạt. */
  roles: RoleDto[];
  draft: AccusationDraft;
  onDraftChange: (draft: AccusationDraft) => void;
}

const MEMBER_SEARCH = { label: 'Tìm người', placeholder: 'Tìm theo tên…', empty: 'Không có ai khớp' };
const ROLE_SEARCH = { label: 'Tìm role', placeholder: 'Tìm role…', empty: 'Không có role nào khớp' };
const FACTION_GROUPS: SelectGroup<Faction | ''>[] = [{ options: FACTIONS.map((faction) => ({ value: faction, label: FACTION_SHORT_LABEL[faction] })) }];

export function AccusationPickers({ roles, draft, onDraftChange }: AccusationPickersProps) {
  const me = useMe();
  const members = useQuery(memberOptionsQuery);

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
    <QueryState query={members}>
      {(list) => (
        <div className="flex flex-col gap-3">
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
        </div>
      )}
    </QueryState>
  );
}
