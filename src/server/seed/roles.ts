import type { Faction } from '@prisma/client';

export type RoleSeed = {
  key: string;
  faction: Faction;
  nameVi: string;
  nameEn: string;
  description: string;
  metricLabel: string;
  maxPerGame: number;
  /** Điểm mỗi đơn vị chỉ số chính (spec điểm role §4: role tối đa 1 mỗi trận 5, role bắn 3 hoặc 5, còn lại 1). */
  points: number;
  /** Chỉ số phụ: cả ba cùng có hoặc cùng null (spec chỉ số phụ §3). */
  extraMetricLabel: string | null;
  extraMaxPerGame: number | null;
  extraPoints: number | null;
  /** Chỉ số phạt (bị trừ): cả ba cùng có hoặc cùng null (spec điểm role §3). */
  penaltyMetricLabel: string | null;
  penaltyMaxPerGame: number | null;
  penaltyPoints: number | null;
  mapNote: string | null;
  modeKey: string | null;
  icon: string;
  active: boolean;
  sortOrder: number;
};

type MainRow = [
  key: string,
  nameVi: string,
  nameEn: string,
  description: string,
  metricLabel: string,
  maxPerGame: number,
  mapNote: string | null,
  icon: string,
  /** Chỉ số phụ (tuỳ chọn): tên, tối đa mỗi trận, điểm mỗi lần. */
  extra?: ExtraMetric,
];

type ExtraMetric = readonly [label: string, maxPerGame: number, points: number];

/** Nhãn chỉ số phạt của các role bắn phe Ngỗng (spec điểm role §4). */
const WRONG_SHOT_LABEL = 'Số phát bắn sai';

/**
 * Điểm khởi đầu riêng theo `key` (spec điểm role §4) — cùng giá trị với migration
 * `20261028120000_role_points_accusations`: Dân phòng 5 điểm mỗi phát trúng, bắn sai tối đa 1 lần
 * −3; Người vận động hành lang, Binh lính, Cảnh sát trưởng, Người báo thù 3 điểm mỗi phát trúng,
 * bắn sai tối đa = `maxPerGame` của role, −1. Role không có trong bảng: tối đa 1 mỗi trận → 5 điểm
 * (thay luật ×5 cũ), còn lại 1; không có chỉ số phạt.
 */
const STARTING_POINTS: Readonly<Record<string, { points: number; penaltyMaxPerGame: number | 'maxPerGame'; penaltyPoints: number }>> = {
  vigilante: { points: 5, penaltyMaxPerGame: 1, penaltyPoints: 3 },
  lobbyist: { points: 3, penaltyMaxPerGame: 'maxPerGame', penaltyPoints: 1 },
  soldier: { points: 3, penaltyMaxPerGame: 'maxPerGame', penaltyPoints: 1 },
  sheriff: { points: 3, penaltyMaxPerGame: 'maxPerGame', penaltyPoints: 1 },
  avenger: { points: 3, penaltyMaxPerGame: 'maxPerGame', penaltyPoints: 1 },
};

/** Điểm mỗi lần và chỉ số phạt khởi đầu của một role chính theo `key` và `maxPerGame`. */
function startingPoints(key: string, maxPerGame: number): Pick<RoleSeed, 'points' | 'penaltyMetricLabel' | 'penaltyMaxPerGame' | 'penaltyPoints'> {
  const special = STARTING_POINTS[key];
  if (!special) return { points: maxPerGame === 1 ? 5 : 1, penaltyMetricLabel: null, penaltyMaxPerGame: null, penaltyPoints: null };
  return {
    points: special.points,
    penaltyMetricLabel: WRONG_SHOT_LABEL,
    penaltyMaxPerGame: special.penaltyMaxPerGame === 'maxPerGame' ? maxPerGame : special.penaltyMaxPerGame,
    penaltyPoints: special.penaltyPoints,
  };
}

function mainRoles(faction: Faction, rows: readonly MainRow[]): RoleSeed[] {
  return rows.map(([key, nameVi, nameEn, description, metricLabel, maxPerGame, mapNote, icon, extra], i) => ({
    key,
    faction,
    nameVi,
    nameEn,
    description,
    metricLabel,
    maxPerGame,
    extraMetricLabel: extra?.[0] ?? null,
    extraMaxPerGame: extra?.[1] ?? null,
    extraPoints: extra?.[2] ?? null,
    ...startingPoints(key, maxPerGame),
    mapNote,
    modeKey: null,
    icon,
    active: true,
    sortOrder: i + 1,
  }));
}

// Spec §6.1 — Phe Ngỗng (30 role)
const GOOSE_ROLES = mainRoles('goose', [
  ['goose', 'Ngỗng', 'Goose', 'Làm nhiệm vụ và vote loại Vịt khỏi phòng.', 'Số lần vote trúng Vịt', 10, null, '🪿'],
  ['gravy', 'Ngỗng ba gang', 'Gravy', 'Ngỗng bị kẻ xấu săn lùng; mục tiêu là sống sót tới cuối trận.', 'Số trận sống sót đến cuối', 1, null, '🍲'],
  ['medium', 'Thầy đồng', 'Medium', 'Nhìn thấy hồn ma và nơi người chết gục ngã.', 'Số xác ẩn được bạn phát hiện', 10, null, '🔮'],
  ['vigilante', 'Dân phòng', 'Vigilante', 'Có một phát bắn để hạ kẻ tình nghi; bắn nhầm Ngỗng thì tự chết.', 'Số phát bắn trúng kẻ xấu', 1, null, '🔫'],
  ['sheriff', 'Cảnh sát trưởng', 'Sheriff', 'Được phép bắn kẻ tình nghi; bắn nhầm Ngỗng thì tự chết.', 'Số phát bắn trúng kẻ xấu', 10, null, '⭐'],
  ['canadian', 'Người Canada', 'Canadian', 'Khi bị giết sẽ tự báo xác và xin lỗi, buộc họp ngay lập tức.', 'Số lần tự báo xác khiến hung thủ bị vote', 1, null, '🍁'],
  ['lover_goose', 'Tình nhân (ngỗng)', 'Lover', 'Được ghép đôi với một người khác; thắng khi cả hai sống tới cuối.', 'Số trận thắng cùng người yêu', 1, null, '💞'],
  ['mimic', 'Kẻ bắt chước', 'Mimic', 'Trong mắt Vịt bạn trông như Vịt và nghe được kênh riêng của chúng.', 'Số Vịt bị lộ nhờ bạn', 5, null, '🎭'],
  ['detective', 'Thám tử', 'Detective', 'Điều tra người khác để biết họ là Ngỗng hay kẻ xấu.', 'Số lần điều tra trúng hung thủ', 10, null, '🔍'],
  ['birdwatcher', 'Kẻ rình mò', 'Birdwatcher', 'Dùng ống nhòm nhìn xuyên tường để bắt quả tang hành động mờ ám.', 'Số lần bắt quả tang giết hoặc chui cống', 10, null, '🔭'],
  ['bodyguard', 'Vệ sĩ', 'Bodyguard', 'Bảo vệ một người quan trọng để họ sống sót tới cuối trận.', 'Số trận giữ VIP sống đến cuối', 1, null, '🛡️'],
  ['politician', 'Chính trị gia', 'Politician', 'Không bị tống vào tù và luôn thắng khi vote hoà.', 'Số lần thắng vote hoà', 10, 'Bản đồ có nhà tù', '🎩'],
  ['locksmith', 'Thợ khoá', 'Locksmith', 'Mở khoá cửa và giải cứu người bị nhốt trong tù.', 'Số người được giải cứu khỏi tù', 10, 'Bản đồ có nhà tù', '🔑'],
  ['mortician', 'Pháp y', 'Mortician', 'Khám xác để biết thời điểm chết và ai từng ở gần.', 'Số xác khám ra thông tin hữu ích', 10, null, '⚰️'],
  ['celebrity', 'Người nổi tiếng', 'Celebrity', 'Khi bạn chết, mọi người lập tức biết bạn chết ở đâu và lúc nào.', 'Số lần hung thủ bị vote sau khi bạn chết', 1, null, '🌟'],
  ['adventurer', 'Nhà thám hiểm', 'Adventurer', 'Miễn nhiễm với phá hoại và nguy hiểm từ môi trường.', 'Số lần thoát chết do môi trường hoặc phá hoại', 10, null, '🧭'],
  ['avenger', 'Người báo thù', 'Avenger', 'Khi người bạn chọn bị giết, bạn được quyền trả thù hung thủ.', 'Số lần trả thù trúng kẻ xấu', 5, null, '🗡️'],
  ['astral', 'Tinh linh', 'Astral', 'Xuất hồn rời xác để đi do thám khắp bản đồ.', 'Số lần bắt quả tang khi xuất hồn', 10, null, '👁️'],
  ['engineer', 'Kỹ sư', 'Engineer', 'Sửa phá hoại từ xa và thấy được ai đang phá hoại.', 'Số kẻ phá hoại bị bạn tìm ra', 10, null, '🔧'],
  ['street_urchin', 'Bụi đời', 'Street Urchin', 'Tự mở khoá để thoát khỏi phòng bị nhốt và cứu người khác.', 'Số lần mở khoá cứu người', 10, 'Chỉ có ở Ancient Sands', '🧢'],
  ['tracker', 'Kẻ theo dấu', 'Tracker', 'Thấy vết chân của người khác ngay cả trong bão cát.', 'Số hung thủ lộ diện trong bão cát', 10, 'Chỉ có ở Ancient Sands', '🐾'],
  ['stalker', 'Kẻ đeo bám', 'Stalker', 'Chọn một người để theo dõi mọi hành động của họ.', 'Số Vịt bị lộ nhờ theo dõi', 5, null, '👀'],
  ['survivalist', 'Người sống sót', 'Survivalist', 'Vẫn sống sót khi đếm ngược phá hoại kết thúc.', 'Số lần sống qua đếm ngược', 1, null, '🏕️'],
  ['scientist', 'Nhà khoa học', 'Scientist', 'Quét bản đồ để phát hiện xác chết.', 'Số xác tìm thấy nhờ quét', 10, null, '🧪'],
  ['lobbyist', 'Người vận động hành lang', 'Lobbyist', 'Có quyền giết nếu thuyết phục được đủ người ủng hộ trong cuộc họp.', 'Số phát giết trúng kẻ xấu', 10, null, '🤝'],
  ['fortune_teller', 'Thầy bói', 'Fortune Teller', 'Rút bài để nhận gợi ý về hung thủ.', 'Số hung thủ đoán đúng từ bài', 10, null, '🃏'],
  ['soldier', 'Binh lính', 'Soldier', 'Được trang bị vũ khí để hạ kẻ xấu; giết nhầm Ngỗng sẽ bị trừng phạt.', 'Số phát giết trúng kẻ xấu', 10, null, '🎖️'],
  ['coroner', 'Điều tra viên (?)', 'Coroner', 'Nhận thêm thông tin đặc biệt mỗi khi báo xác.', 'Số xác đã báo', 15, null, '🩺'],
  ['sensor', 'Cảm biến', 'Sensor', 'Quét bản đồ để phát hiện vị trí của Vịt.', 'Số Vịt bị bắt nhờ quét bản đồ', 10, null, '📡'],
  ['lucid_dreamer', 'Kẻ điều khiển giấc mơ', 'Lucid Dreamer', 'Nhận manh mối về hung thủ trong giấc mơ.', 'Số manh mối giấc mơ dẫn tới vote đúng', 10, null, '💤'],
]);

// Spec §6.2 — Phe Vịt (31 role)
const DUCK_ROLES = mainRoles('duck', [
  ['duck', 'Vịt', 'Duck', 'Giết Ngỗng và phá hoại mà không bị lộ.', 'Số mạng đã giết', 15, null, '🦆'],
  ['lover_duck', 'Tình nhân (vịt)', 'Lover', 'Được ghép đôi với một người khác; thắng khi cả hai sống tới cuối.', 'Số trận thắng cùng người yêu', 1, null, '💔'],
  ['cannibal', 'Kẻ ăn xác', 'Cannibal', 'Ăn xác nạn nhân để xoá dấu vết.', 'Số xác đã ăn', 15, null, '🍖'],
  ['morphling', 'Kẻ cải trang', 'Morphling', 'Cải trang thành người khác trong thời gian ngắn.', 'Số mạng giết khi đang cải trang', 15, null, '🪞'],
  ['silencer', 'Kẻ câm lặng', 'Silencer', 'Làm một người không thể nói trong cuộc họp.', 'Số người bị bạn câm rồi bị vote ra', 10, null, '🤫'],
  ['professional', 'Cao thủ', 'Professional', 'Vịt lão luyện với thời gian hồi chiêu giết ngắn hơn.', 'Số mạng đã giết', 15, null, '😎'],
  ['spy', 'Gián điệp', 'Spy', 'Soi được role của người khác.', 'Số role đã soi được', 10, null, '🕵️'],
  // Chỉ số phụ (spec chỉ số phụ §1): mỗi mạng giết +1, mỗi lần ám sát trong họp +3 (tối đa 2 mỗi ván).
  ['assassin', 'Ám sát', 'Assassin', 'Ám sát ngay trong cuộc họp bằng cách đoán đúng role của nạn nhân.', 'Số mạng đã giết', 15, null, '🗡️', ['Số lần ám sát trong cuộc họp', 2, 3]],
  ['hitman', 'Sát thủ', 'Hitman', 'Được giao mục tiêu cụ thể để hạ.', 'Số mục tiêu đã hạ', 10, null, '🎯'],
  ['snitch', 'Kẻ mách lẻo', 'Snitch', 'Tống người khác vào tù.', 'Số người bị tống tù', 10, 'Bản đồ có nhà tù', '📣'],
  ['party', 'Tiệc tùng', 'Party', 'Mở tiệc để gom mọi người lại một chỗ rồi ra tay.', 'Số mạng đã giết', 15, null, '🎉'],
  ['demolitionist', 'Kẻ đặt bom', 'Demolitionist', 'Đặt bom nổ chậm để giết nhiều người cùng lúc.', 'Số mạng chết vì bom', 15, null, '💣'],
  ['identity_thief', 'Kẻ cắp danh tính', 'Identity Thief', 'Giết người rồi lấy luôn danh tính của họ.', 'Số mạng đã giết', 15, null, '🪪'],
  ['ninja', 'Nhẫn giả', 'Ninja', 'Giết hai người cùng lúc khi họ đứng gần nhau.', 'Số lần giết đôi', 7, null, '🥷'],
  ['undertaker', 'Kẻ kéo lê', 'Undertaker', 'Kéo xác đi giấu để không ai báo được.', 'Số xác giấu không ai báo', 15, null, '🪦'],
  ['invisibility', 'Tàng hình', 'Invisibility', 'Tàng hình trong thời gian ngắn để ra tay.', 'Số mạng giết khi tàng hình', 15, null, '👻'],
  ['serial_killer', 'Kẻ giết người hàng loạt', 'Serial Killer', 'Chỉ được giết đúng mục tiêu được giao; giết sai sẽ bị phạt.', 'Số lần giết đúng mục tiêu', 15, null, '🔪'],
  ['warlock', 'Thầy pháp', 'Warlock', 'Triệu hồi bầy châu chấu tấn công người khác.', 'Số mạng chết vì bầy châu chấu', 15, 'Chỉ có ở Ancient Sands', '🦗'],
  ['esper', 'Siêu năng lực gia', 'Esper', 'Giết từ xa bằng sức mạnh tâm linh.', 'Số mạng giết từ xa', 15, null, '🧠'],
  ['preacher', 'Nhà truyền giáo', 'Preacher', 'Thuyết giáo khiến Ngỗng bị nghi ngờ và vote ra.', 'Số Ngỗng bị vote ra', 10, null, '📖'],
  ['cupid', 'Thần tình yêu', 'Cupid', 'Buộc hai người bằng sợi dây tình; một người chết thì người kia chết theo.', 'Số mạng chết vì sợi dây tình', 15, 'Chỉ có ở Eagleton Springs', '💘'],
  ['drone', 'Quái vật', 'Drone', 'Quái vật ẩn nấp rồi bất ngờ tấn công.', 'Số mạng đã giết', 15, 'Chỉ có ở Eagleton Springs', '👾'],
  ['mime', 'Nghệ sĩ kịch câm', 'Mime', 'Điều khiển người khác đi vào chỗ chết.', 'Số mạng chết khi bị bạn điều khiển', 15, null, '🤐'],
  ['clown', 'Chú hề', 'Clown', 'Phát bóng bay phát nổ cho người khác.', 'Số người bị nổ bóng', 15, null, '🤡'],
  ['looter', 'Kẻ hôi của (?)', 'Looter', 'Hôi của từ xác chết để xoá dấu vết.', 'Số xác đã xử lý', 15, 'Chỉ có ở Mallardon', '💰'],
  ['sniper', 'Bắn tỉa', 'Sniper', 'Bắn hạ mục tiêu từ xa.', 'Số mạng bắn tỉa', 15, null, '🔭'],
  ['witch_doctor', 'Thầy phù thuỷ', 'Witch Doctor', 'Nguyền rủa người khác để họ chết sau một thời gian.', 'Số mạng chết vì lời nguyền', 15, null, '🧙'],
  ['lost_duckling', 'Vịt con lạc lối', 'Lost Duckling', 'Vịt con lạc đàn: giết được bất kỳ ai nhưng không biết ai là Vịt.', 'Số mạng giết (không tính Vịt)', 15, null, '🐥'],
  ['carrier', 'Vật chủ', 'Carrier', 'Cấy ký sinh trùng vào người khác.', 'Số lần cấy ký sinh thành công', 15, null, '🦠'],
  ['parasite', 'Ký sinh trùng', 'Parasite', 'Chiếm quyền điều khiển vật chủ rồi hạ họ.', 'Số vật chủ đã hạ', 15, null, '🪱'],
  ['swordsman', 'Kiếm sĩ', 'Swordsman', 'Vung kiếm chém mọi người đứng gần.', 'Số mạng chém', 15, 'Có từ v4.10 (08/2026)', '⚔️'],
]);

// Spec §6.3 — Phe thứ 3 (10 role)
const NEUTRAL_ROLES = mainRoles('neutral', [
  ['dodo', 'Chim đa đa', 'Dodo', 'Thắng nếu bị mọi người vote ra.', 'Số trận thắng (bị vote ra)', 1, null, '🦤'],
  ['dueling_dodos', 'Đa đa song đấu', 'Dueling Dodos', 'Hai Đa đa đấu nhau: ai bị vote ra trước sẽ thắng.', 'Số trận thắng', 1, null, '🤼'],
  ['vulture', 'Kền kền', 'Vulture', 'Ăn đủ số xác để thắng.', 'Số xác đã ăn', 15, null, '🦴'],
  ['pigeon', 'Chim bồ câu', 'Pigeon', 'Lây bệnh cho tất cả mọi người để thắng.', 'Số người đã lây', 15, null, '🕊️'],
  ['falcon', 'Chim ưng', 'Falcon', 'Giết tất cả mọi người, kể cả Vịt.', 'Số mạng đã giết', 15, null, '🦅'],
  ['pelican', 'Bồ nông', 'Pelican', 'Nuốt người khác vào bụng; thắng khi nuốt đủ.', 'Số người đã nuốt', 15, null, '🦩'],
  ['hawk', 'Diều hâu', 'Hawk', 'Giết để trở thành người sống sót cuối cùng.', 'Số mạng đã giết', 15, 'Chỉ có ở Mallardon', '🪶'],
  ['raven', 'Quạ đen', 'Raven', 'Giết mọi người để thắng một mình.', 'Số mạng đã giết', 15, null, '🐦‍⬛'],
  ['cuckoo', 'Cò gáy', 'Cuckoo', 'Đẻ trứng vào tổ người khác; thắng nếu trứng không bị đập.', 'Số trứng không bị đập', 30, 'Có từ v4.08 (04/2026)', '🥚'],
  ['magpie', 'Chim ác là', 'Magpie', 'Đoán đúng role của người khác để thắng.', 'Số lần đoán đúng role', 15, 'Có từ v4.10 (08/2026)', '🐦'],
]);

// Spec §6.4 — Role riêng của chế độ đặc biệt: nạp sẵn nhưng tắt, phe là dự đoán.
type SpecialRow = [key: string, nameVi: string, nameEn: string, faction: Faction, modeKey: string];

const SPECIAL_ROWS: readonly SpecialRow[] = [
  ['inquisitor', 'Thanh tra', 'Inquisitor', 'goose', 'corruption'],
  ['saint', 'Thánh', 'Saint', 'goose', 'corruption'],
  ['demon_hunter', 'Thợ săn quỷ', 'Demon Hunter', 'goose', 'corruption'],
  ['seamstress', 'Thợ may', 'Seamstress', 'goose', 'corruption'],
  ['high_priest', 'Đại tư tế', 'High Priest', 'duck', 'corruption'],
  ['initiate', 'Tông đồ', 'Initiate', 'duck', 'corruption'],
  ['sin_eater', 'Kẻ xoá tội', 'Sin Eater', 'duck', 'corruption'],
  ['crow', 'Quạ', 'Crow', 'neutral', 'corruption'],
  ['villager', 'Villager (?)', 'Villager', 'goose', 'trick_or_treat'],
  ['vampire', 'Vampire (?)', 'Vampire', 'duck', 'trick_or_treat'],
  ['mummy', 'Mummy (?)', 'Mummy', 'duck', 'trick_or_treat'],
  ['thrall', 'Thrall (?)', 'Thrall', 'duck', 'trick_or_treat'],
  ['dr_turducken', 'Dr. Turducken (?)', 'Dr. Turducken', 'duck', 'trick_or_treat'],
  ['turducken_monster', "Turducken's Monster (?)", "Turducken's Monster", 'duck', 'trick_or_treat'],
  ['wereduck', 'Wereduck (?)', 'Wereduck', 'duck', 'trick_or_treat'],
  ['chicken', 'Chicken (?)', 'Chicken', 'goose', 'tastes_like_chicken'],
  ['camo_duck', 'Camo Duck (?)', 'Camo Duck', 'duck', 'tastes_like_chicken'],
  ['owl', 'Owl (?)', 'Owl', 'goose', 'hoot_seek'],
  ['hoot_sniper', 'Sniper (?)', 'Sniper', 'duck', 'hoot_seek'],
  ['hoot_spotter', 'Spotter (?)', 'Spotter', 'duck', 'hoot_seek'],
];

const FACTION_ICON: Record<Faction, string> = { goose: '🪿', duck: '🦆', neutral: '🐦' };

const SPECIAL_ROLES: RoleSeed[] = SPECIAL_ROWS.map(([key, nameVi, nameEn, faction, modeKey], i) => ({
  key,
  faction,
  nameVi,
  nameEn,
  description: 'Role riêng của chế độ đặc biệt; admin xác nhận phe và chỉ số rồi mới bật.',
  metricLabel: 'Chưa đặt chỉ số',
  maxPerGame: 15,
  points: 1,
  extraMetricLabel: null,
  extraMaxPerGame: null,
  extraPoints: null,
  penaltyMetricLabel: null,
  penaltyMaxPerGame: null,
  penaltyPoints: null,
  mapNote: null,
  modeKey,
  icon: FACTION_ICON[faction],
  active: false,
  sortOrder: i + 1,
}));

export const ROLES: readonly RoleSeed[] = [...GOOSE_ROLES, ...DUCK_ROLES, ...NEUTRAL_ROLES, ...SPECIAL_ROLES];
