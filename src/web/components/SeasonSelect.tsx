import type { SeasonDto } from '../../shared/api-types';
import { formatSeasonLabel } from '../lib/format';

interface SeasonSelectProps {
  seasons: SeasonDto[];
  value: string;
  onChange: (seasonId: string) => void;
}

/** Ô chọn mùa (nhãn "Mùa"): `Tháng 10/2026`, mùa đã chốt ghi thêm "(đã chốt)". */
export function SeasonSelect({ seasons, value, onChange }: SeasonSelectProps) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="font-medium">Mùa</span>
      <select className="field w-auto" value={value} onChange={(event) => onChange(event.target.value)}>
        {seasons.map((season) => (
          <option key={season.id} value={season.id}>
            {formatSeasonLabel(season.id)}
            {season.closed ? ' (đã chốt)' : ''}
          </option>
        ))}
      </select>
    </label>
  );
}
