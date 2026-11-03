-- AlterTable
ALTER TABLE "roles" ADD COLUMN     "extra_max_per_game" INTEGER,
ADD COLUMN     "extra_metric_label" TEXT,
ADD COLUMN     "extra_points" INTEGER;

-- AlterTable
ALTER TABLE "stat_reports" ADD COLUMN     "extra_value" INTEGER NOT NULL DEFAULT 0;

-- Chỉ số phụ của role: ba cột cùng null (không có) hoặc cùng có (spec chỉ số phụ §4).
ALTER TABLE roles ADD CONSTRAINT roles_extra_metric_all_or_none CHECK (
  (extra_metric_label IS NULL AND extra_max_per_game IS NULL AND extra_points IS NULL)
  OR (extra_metric_label IS NOT NULL AND extra_max_per_game IS NOT NULL AND extra_points IS NOT NULL)
);
ALTER TABLE stat_reports ADD CONSTRAINT stat_reports_extra_value_nonneg CHECK (extra_value >= 0);

-- Ám sát: chỉ số chính thành "Số mạng đã giết" (×1, tối đa 15), chỉ số phụ là ám sát trong
-- cuộc họp (tối đa 2, ×3). Seed không ghi đè role đã có nên DB thật chỉ đổi qua đây;
-- DB không có role `assassin` thì hai câu dưới không làm gì.
UPDATE "roles"
SET "metric_label" = 'Số mạng đã giết',
    "max_per_game" = 15,
    "extra_metric_label" = 'Số lần ám sát trong cuộc họp',
    "extra_max_per_game" = 2,
    "extra_points" = 3
WHERE "key" = 'assassin';

-- Số cũ của Ám sát là số lần ám sát trong họp → chuyển sang chỉ số phụ (mọi trạng thái lần khai).
UPDATE "stat_reports" SET "extra_value" = "value", "value" = 0 WHERE "role_id" = (SELECT "id" FROM "roles" WHERE "key" = 'assassin');
