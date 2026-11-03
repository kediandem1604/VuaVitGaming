import type { SeasonDto } from '../../shared/api-types';
import { formatSeasonLabel } from '../lib/format';
import { Select } from './Select';

interface SeasonSelectProps {
  seasons: SeasonDto[];
  value: string;
  onChange: (seasonId: string) => void;
}

/**
 * Ô chọn mùa (nhãn "Mùa", không nhóm, không ô tìm) trên ô chọn tự làm `Select`: dòng
 * `Tháng 10/2026`, mùa đã chốt ghi thêm "(đã chốt)".
 */
export function SeasonSelect({ seasons, value, onChange }: SeasonSelectProps) {
  const options = seasons.map((season) => ({
    value: season.id,
    label: `${formatSeasonLabel(season.id)}${season.closed ? ' (đã chốt)' : ''}`,
  }));
  return <Select label="Mùa" value={value} onChange={onChange} groups={[{ options }]} />;
}
