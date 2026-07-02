import { seededShuffle } from "./seeded-random.js";

export type SinksEventResolution = "lowest_roll" | "conversation" | "none";

export interface SinksEventCard {
  id: string;
  title: string;
  text: string;
  resolution: SinksEventResolution;
}

export interface SinksDayEvent {
  day: number;
  card: SinksEventCard;
  isFinalDay: boolean;
}

export interface SinksEventSchedule {
  opening: SinksEventCard;
  days: SinksDayEvent[];
  endsOnDay: number;
  removedCardIds: string[];
}

export const SINKS_SPECIAL_EVENT_CARDS: readonly SinksEventCard[] = [
  {
    id: "fisherman_found",
    title: "낚시꾼이 시체로 발견되다",
    resolution: "none",
    text: "그는 여러분을 제외한 호텔의 유일한 손님이었습니다. 그는 해변에서 아홉 발자국 떨어진 자리에서 발견되었습니다. 바위에 머리를 부딪힌 상처가 있습니다. 사고일까요, 살인일까요? 누군가 그를 알고 있던 인물이 있을까요?",
  },
  {
    id: "island_sinks",
    title: "섬이 가라앉다",
    resolution: "none",
    text: "우리는 바다에서 호텔 소유주의 고장난 보트를 타고 있습니다. 아침에 일어났을 때에 바닷물이 발목 높이까지 차 있었으며, 보트에 타고 나서 얼마 지나지 않아 섬 전체가 파도 속으로 사라졌습니다. 위험은 이제 지나갔고, 바다는 고요하며, 구조대가 몇 시간 안에 도착할 것입니다. 그 사이에 모든 것이 해명될 것입니다.",
  },
];

export const SINKS_GENERAL_EVENT_CARDS: readonly SinksEventCard[] = [
  {
    id: "dead_gull",
    title: "해변에서 죽은 갈매기가 발견되다",
    resolution: "none",
    text: "머리에 바늘이 박혀 있었습니다.",
  },
  {
    id: "grim_vandalism",
    title: "우울한 반달리즘",
    resolution: "none",
    text: "새로 만들어진 낚시꾼의 무덤 십자가에, 누군가 검은 페인트로 '돼지새끼'라고 적어 놓았습니다.",
  },
  {
    id: "strange_greeting",
    title: "이상한 인사",
    resolution: "lowest_roll",
    text: "호텔 뒤켠의 야자나무에 인물 중 하나의 이름과 함께 '다시 만나다'라는 글귀가 새겨져 있습니다. 모든 참가자는 주사위를 굴립니다. 가장 낮은 눈이 나온 사람의 이름이 새겨져 있습니다. 만약 가장 낮은 눈이 나온 사람이 여러 명이라면 그 사람들끼리 다시 굴립니다.",
  },
  {
    id: "radio_soaked",
    title: "호텔 라디오가 젖다",
    resolution: "none",
    text: "사고거나 고의일 수 있습니다. 바깥과의 모든 연락이 차단됩니다. 이 곳은 휴대전화 신호가 닿지 않습니다.",
  },
  {
    id: "suspicious_free_ticket",
    title: "의문스런 공짜표",
    resolution: "none",
    text: "죽은 낚시꾼의 방에서 봉투가 발견됩니다. 유람선과 호텔 티켓이 들어있습니다. 다음과 같은 편지와 함께. '휴가를 즐기고 다녀와서 새로운 명작을 써 주세요. 팬이' 이런 공짜표를 받은 인물이 이 중에 또 있을까요?",
  },
  {
    id: "poison",
    title: "독?",
    resolution: "lowest_roll",
    text: "갈매기가 인물에게 대접하려던 음식을 먹었고, 잠시 후 죽었습니다. 음식이 오염된 걸까요? 아니면 독이 들어있던 것일까요? 모든 참가자가 주사위를 굴립니다. 가장 낮은 눈이 나온 사람이 갈매기 덕에 살아난 사람입니다. 만약 가장 낮은 눈이 나온 사람이 여러 명이라면 그 사람들끼리 다시 굴립니다.",
  },
  {
    id: "stolen_underwear",
    title: "팬티를 도둑맞다",
    resolution: "lowest_roll",
    text: "인물 중 한 명의 속옷이 사라졌습니다. 모든 참가자가 주사위를 굴립니다. 가장 낮은 눈이 나온 사람이 속옷이 없어진 사람입니다. 만약 가장 낮은 눈이 나온 사람이 여러 명이라면 그 사람들끼리 다시 굴립니다.",
  },
  {
    id: "dark_history",
    title: "음침한 역사",
    resolution: "conversation",
    text: "호텔 정문 근처에서 인물 중 한 명이 20년 전의 신문 기사가 클립되어 있는 것을 발견합니다. 기사는 이 곳에서 벌어졌던 살인 사건을 보도하고 있습니다. 누가 그것을 발견했는지는 대화 중에 결정됩니다.",
  },
  {
    id: "shadow_in_storm",
    title: "폭풍 속의 그림자",
    resolution: "lowest_roll",
    text: "지난 밤 폭풍이 불었습니다. 기물이 여럿 손상되었고 보트는 거의 뒤집힐 뻔했습니다. 인물 중 한 명이 폭풍 속에서 사람의 형체를 보았습니다. 누가 거기에 있을 수 있었을까요? 무엇을 하고 있었던 것일까요? 모든 참가자가 주사위를 굴립니다. 가장 낮은 눈이 나온 사람이 형체를 발견한 사람입니다. 만약 가장 낮은 눈이 나온 사람이 여러 명이라면 그 사람들끼리 다시 굴립니다.",
  },
  {
    id: "femur",
    title: "대퇴골",
    resolution: "conversation",
    text: "누군가 섬을 산책하다가 땅에 반쯤 묻혀 있는 물체에 발이 걸렸습니다. 가까이에서 보니 그것은 사람의 뼈였습니다! 누가 그것을 발견했는지는 대화 중에 결정됩니다.",
  },
  {
    id: "strangers",
    title: "이방인",
    resolution: "none",
    text: "오늘 아침에 이방인 둘이 이 섬에 도착했습니다. 그들은 무례했고, 거만했고, 시간이 흐른 뒤에는, 취했습니다. 몇 시간 뒤에 그들의 보트가 사라졌습니다. 그들은 떠난다고 아무에게도 말하지 않았고, 아무도 그들이 떠나는 것을 보지 못했습니다. 우리 중 누군가 그들과 할 일이 있었을까요? 무슨 일이 일어난 걸까요? 그냥 우연히 일어난 일일 뿐일까요, 아니면 그들에게 무언가 목적이 있었던 것일까요?",
  },
  {
    id: "the_lie",
    title: "거짓말",
    resolution: "lowest_roll",
    text: "누군가 거짓말을 하고 있었다는 사실이 우연히 발각되었습니다. 모든 참가자가 주사위를 굴립니다. 가장 낮은 눈이 나온 사람이 거짓말한 사람입니다. 만약 가장 낮은 눈이 나온 사람이 여러 명이라면 그 사람들끼리 다시 굴립니다. 거짓말을 한 인물의 플레이어가 무엇이 거짓말이었고 그것이 어떻게 발각되었는지를 결정합니다. 무슨 거짓말을 했는지는 임의로 정할 수 있습니다. 이 카드는 그가 왜 거짓말을 했는지 밝혀졌을 때 해명됩니다.",
  },
  {
    id: "private_conversation",
    title: "사적인 대화",
    resolution: "lowest_roll",
    text: "인물 중 하나가 다른 인물 둘의 대화를 우연히 포착했지만, 내용을 전부 엿듣지는 못했습니다. 모든 참가자가 주사위를 굴립니다. 가장 낮은 눈이 나온 사람이 보아서는 안 되는 것을 보고 들어서는 안 되는 것을 들은 사람입니다. 만약 가장 낮은 눈이 나온 사람이 여러 명이라면 그 사람들끼리 다시 굴립니다. 발견자가 대화자 두 명을 선택합니다. 어떤 내용의 대화가 오고갔는지는 저녁의 대화 중에 결정됩니다.",
  },
];

export function buildSinksEventSchedule(roomId: string): SinksEventSchedule {
  const opening = SINKS_SPECIAL_EVENT_CARDS[0]!;
  const islandSinks = SINKS_SPECIAL_EVENT_CARDS[1]!;
  const shuffledGeneral = seededShuffle(
    SINKS_GENERAL_EVENT_CARDS,
    `${roomId}:until-it-sinks:general-event-deck`,
  );
  const accepted = shuffledGeneral.slice(0, 5);
  const removedCardIds = shuffledGeneral.slice(5).map((card) => card.id);
  const days: SinksDayEvent[] = accepted.slice(0, 3).map((card, index) => ({
    day: index + 2,
    card,
    isFinalDay: false,
  }));
  const closingDeck = seededShuffle(
    [...accepted.slice(3), islandSinks],
    `${roomId}:until-it-sinks:island-sinks-shuffle`,
  );

  let endsOnDay = 7;
  for (const card of closingDeck) {
    const day = days.length + 2;
    const isFinalDay = card.id === "island_sinks";
    days.push({ day, card, isFinalDay });
    if (isFinalDay) {
      endsOnDay = day;
      break;
    }
  }

  return {
    opening,
    days,
    endsOnDay,
    removedCardIds,
  };
}
