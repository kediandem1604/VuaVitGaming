/**
 * Tuỳ chọn cho các giao dịch tương tác trên đường nóng (điểm danh, vote, đóng vote,
 * kết thúc buổi, chốt mùa, rời server). Mặc định của Prisma (chờ lấy kết nối 2 s, chạy
 * tối đa 5 s) quá chặt khi cả hội bấm cùng lúc và các giao dịch xếp hàng sau một khoá
 * dòng, hay khi database ở xa hơn dự kiến: hết giờ thì người bấm nhận lỗi dù thao tác
 * hợp lệ. 10 s chờ kết nối, 15 s chạy vẫn đủ ngắn để một giao dịch kẹt không giữ khoá mãi.
 */
export const HOT_TX = { timeout: 15_000, maxWait: 10_000 } as const;
