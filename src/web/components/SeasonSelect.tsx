import type { SeasonDto } from '../../shared/api-types';
import { formatSeasonLabel } from '../lib/format';

interface SeasonSelectProps {
  seasons: SeasonDto[];
  value: string;
  onChange: (seasonId: string) => void;
}

/** Ô chọn mùa kiểu `field` (nhãn "Mùa"): `Tháng 10/2026`, mùa đã chốt ghi thêm "(đã chốt)". */
export function SeasonSelect({ seasons, value, onChange }: SeasonSelectProps) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="font-bold text-night-300">Mùa</span>
      <select className="field w-auto py-1.5" value={value} onChange={(event) => onChange(event.target.value)}>
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
