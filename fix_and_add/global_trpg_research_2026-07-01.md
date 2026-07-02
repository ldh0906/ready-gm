# Global TRPG Research for AI GM Product - 2026-07-01

## 조사 범위와 원칙

이 문서는 TRPG를 특정 국가나 특정 룰 하나로 보지 않고, 지역별 시장, 플레이 문화, 룰 디자인 계보, 온라인 전환, 실제 제품 설계 함의를 함께 정리한다. 조사 대상은 한국, 일본, 중국, 러시아, 미국, 유럽, 아프리카를 포함하며, 보완적으로 브라질/남미와 남아시아 커뮤니티 사례도 참고한다.

중요한 제한: 유료 룰북 원문이나 저작권 있는 시나리오 전문을 무단으로 긁어오지 않는다. 공개 SRD, 공식 출판사 페이지, 공식 마켓/유통 페이지, 학술/비평 글, 현지 기사, 공개 커뮤니티 관측을 요약한다. 통계가 공개되지 않은 지역은 "공식 통계"와 "커뮤니티 관측"을 구분해 적는다.

## 핵심 결론

TRPG는 하나의 장르가 아니다. "GM이 있고, 캐릭터 시트가 있고, 주사위로 판정한다"는 공통점은 있지만, 실제 재미는 지역별로 매우 다르게 조직된다.

- 미국/영어권은 Dungeons & Dragons, Pathfinder, 실제 플레이 방송, VTT, D&D Beyond류 디지털 툴의 네트워크 효과가 강하다.
- 일본은 Sword World/Replays/라이트노벨/니코니코 actual play와 Call of Cthulhu 조사극 문화가 강하다.
- 한국과 중국은 공개 시장 데이터가 적지만, 커뮤니티 관측상 D&D보다 Call of Cthulhu식 조사/호러/원샷/리플레이 친화성이 강한 신호가 있다.
- 독일은 The Dark Eye처럼 자국어 장기 메타플롯 판타지가 강하고, 북유럽은 Free League/Year Zero 및 Nordic Larp의 감정/안전/협력 설계가 중요하다.
- 러시아권은 Hobby World 같은 대형 보드게임 유통사가 D&D/Pathfinder/CoC 현지화를 공급하는 형태가 눈에 띈다.
- 아프리카는 단일 시장으로 묶으면 안 된다. 공개 데이터는 적지만, 남아공 커뮤니티, Comic Con Africa 같은 행사, Wagadu/Nyambe/Kalymba/Zairoo 같은 아프리카 기반 혹은 아프로판타지 프로젝트가 중요한 참고점이다.
- 브라질은 Tormenta/Jambo처럼 현지 잡지, 판타지 IP, 크라우드펀딩, 소설/만화/게임 확장이 결합된 자국 TRPG 생태계가 강한 사례다.

우리 AI-TRPG 서비스에 대한 결론은 명확하다. "서구식 던전 판타지 원샷"만으로 글로벌 TRPG의 재미를 대표할 수 없다. 특히 한국어 서비스라면 조사/호러/미스터리, 짧은 원샷, 리플레이 가능한 세션 기록, 캐릭터 감정/관계 변화, 안전 도구, 룰셋별 캐릭터 시트 보존을 제품 핵심에 둬야 한다.

## TRPG의 최소 구조

TRPG를 AI 제품으로 만들려면 다음 여섯 가지를 분리해서 저장해야 한다.

1. Shared Fiction: 테이블이 공유하는 현재 허구 세계. 장소, 시간, 위험, NPC, 단서, 분위기.
2. Character Sheet: 플레이어가 "나는 누구인가"를 표현하는 정적/준정적 자료. 능력치뿐 아니라 목표, 결점, 관계, 성격, 비밀을 포함한다.
3. Character State: 세션 중 변하는 자료. 부상, 조건, 장비, 자원, 관계 변화, 개인 clock, 기억.
4. Rules Authority: 어떤 상황에서 누가 판정하고, 어떤 주사위/카드/토큰이 결과를 정하며, 서버가 무엇을 확정하는지.
5. GM Procedure: GM이 장면을 어떻게 전진시키는지. 던전 탐험, 조사, 전투, 관계극, 공포, 코미디마다 절차가 다르다.
6. Session Artifact: 플레이 후 남는 것. 요약, 리플레이 로그, 캐릭터 변화, 다음 세션 hook, 공유 가능한 명장면.

현재 `C:\ready-gm`의 MVP는 1, 4, 일부 5를 향해 가고 있지만 2와 3이 약하다. `fix_and_add/ai_architecture_gap_prompt_2026-07-01.md`에서 정리한 Living Character Sheet가 우선순위인 이유도 여기에 있다.

## 지역별 조사

### 미국 / 영어권

미국/영어권은 현대 TRPG의 출발점에 가깝다. Dungeons & Dragons는 1974년 TSR에서 출발했고, 이후 Basic/AD&D 분화, d20/OGL, 5e, D&D Beyond, 실제 플레이 방송, VTT 확산을 거치며 네트워크 효과가 매우 강해졌다.

중요 신호:

- D&D는 가장 큰 네트워크 효과를 가진 입문 게임이다.
- Pathfinder는 D&D와 같은 d20 계열이지만 더 전술적이고 규칙 밀도가 높은 대안으로 자리잡았다.
- Call of Cthulhu, Vampire: The Masquerade, Cyberpunk, Savage Worlds, Powered by the Apocalypse, Blades in the Dark, Lancer 등 다양한 중대형 대안군이 존재한다.
- Critical Role, Dimension 20류 actual play는 "남이 플레이하는 TRPG를 보는 문화"를 대중화했다.
- Roll20, Foundry VTT, StartPlaying 같은 플랫폼은 온라인 플레이와 전문 GM 시장을 키웠다.
- WotC가 D&D SRD를 Creative Commons로 제공하면서 5e 호환 생태계의 법적 기반이 더 넓어졌다.

제품 함의:

- D&D식 전투 자동화만 만들면 이미 강한 경쟁자가 많다.
- 영어권 모델을 그대로 한국어 서비스에 이식하면 차별화가 약하다.
- actual play와 세션 후 공유물이 입문/바이럴의 핵심이다.
- 캐릭터 빌드, 전투 지도, 아이템 관리보다 "테이블 경험을 계속 이어주는 기록"이 AI 서비스 차별점이 될 수 있다.

### 일본

일본은 "TRPG"라는 용어 사용, replay book 문화, Sword World, Record of Lodoss War, Niconico actual play, Call of Cthulhu 강세가 특징이다.

중요 신호:

- 일본에서는 tabletop보다 "TRPG"라는 표현이 일반적이다.
- Group SNE의 replay book은 세션 기록을 라이트노벨처럼 읽는 문화로 만들었다.
- Record of Lodoss War는 원래 D&D 리플레이에서 출발해 판타지 대중문화에 큰 영향을 줬다.
- Sword World는 일본 자국 판타지 TRPG의 대표 사례이며, d6 중심 접근성과 리플레이/소설/미디어믹스와 연결되어 성장했다.
- Call of Cthulhu는 일본에서 매우 강한 위치를 가진 것으로 여러 기사와 커뮤니티 관측에서 반복 확인된다.
- Niconico/YouTube의 TRPG 리플레이 영상은 신규 유입 경로가 됐다.

제품 함의:

- 세션 로그는 단순 기록이 아니라 콘텐츠다. AI 서비스는 "리플레이로 읽기 좋은 로그"를 자동 생성할 수 있어야 한다.
- 한국/일본권 플레이어에게는 장기 전술 캠페인보다 2-4시간 조사극/호러 원샷이 더 강한 진입점일 수 있다.
- 캐릭터 시트에는 스탯보다 성격, 말투, 비밀, 관계, 공포 반응이 중요하다.
- "AI GM이 진행한 세션을 웹툰/라이트노벨식 리플레이로 변환"하는 기능은 장기 차별화 후보가 된다.

### 한국

한국은 공개 시장 통계가 매우 제한적이다. 다만 텀블벅 D&D 한국어판 펀딩 기사, CoC 관련 커뮤니티 활동, TRPG 위키/커뮤니티 기록, 온라인 모임 문화에서 몇 가지 신호가 보인다.

중요 신호:

- 2019년 D&D 5판 한국어판 크라우드펀딩은 큰 관심을 받았고, 당시 기사들은 텀블벅 게임 카테고리 기록 경신을 언급했다.
- 한국 TRPG 커뮤니티에서는 Call of Cthulhu, D&D, 인세인, 피아스코, 던전월드, 자작룰/단편 시나리오 문화가 혼재해 왔다.
- 국내 TRPG는 오프라인 매장 대중화보다 온라인 커뮤니티, 지인 초대, 디스코드/채팅 기반 세션 비중이 큰 편으로 보인다.
- 공개 통계가 부족하므로 "한국 시장 1위 룰" 같은 단정은 피해야 한다. 하지만 한국어 네이티브 GM, 짧은 원샷, 친구 초대형 플레이는 분명한 기회다.

제품 함의:

- 한국어 AI GM은 단순 번역이 아니라 말투, 장면 묘사 밀도, 드립/공포/일상 대사의 자연스러움이 중요하다.
- 친구 초대 링크, 레디체크, 짧은 원샷, 세션 요약 공유는 한국 타깃과 잘 맞는다.
- D&D식 장기 캠페인보다 "오늘 밤 2시간 안에 끝나는 조사/공포/코미디 원샷"을 우선 보강해야 한다.
- 한국어 시나리오 UGC는 장기 해자가 될 수 있지만, 초반에는 저품질 리스크가 크므로 수동 큐레이션이 먼저다.

### 중국

중국권에서는 "跑团"이라는 표현이 널리 쓰인다. 공개 자료상 D&D, Call of Cthulhu, Fabula Ultima, 각종 현지 플랫폼/커뮤니티, Bilibili actual play, script murder game 문화와의 접점이 보인다.

중요 신호:

- 중국어권에서 TRPG는 "跑团"으로 설명되는 경우가 많고, 면대면/온라인/텍스트/음성 세션이 구분된다.
- Gcores, Bilibili, Zhihu, 커뮤니티 글에서 CoC와 D&D가 반복적으로 등장한다.
- 중국에서는 script murder game과 TRPG가 모두 "사회적 추리/역할극/시나리오 소비"라는 넓은 문화권 안에서 만날 수 있다.
- 일부 커뮤니티 관측은 CoC가 중국에서도 강하다고 말하지만, 공식 시장 통계로 확정하기는 어렵다.
- 크라우드펀딩과 현지화 출판이 중요한 유통 경로로 보인다.

제품 함의:

- 조사/미스터리/사회적 추리 구조는 동아시아권 공통 강점이다.
- AI GM은 단서를 하나만 주면 안 된다. 같은 결론에 도달하는 복수 단서 경로가 필요하다.
- 텍스트 기반 세션, 비동기 로그, 리플레이 변환은 중국권/동아시아권 플레이 스타일과 잘 맞는다.
- 지역 확장을 고려한다면 톤/검열/민감 주제 회피 정책을 Safety Profile과 별도로 관리해야 한다.

### 러시아 / 동유럽

러시아권은 공개 영어 자료가 많지 않지만, Hobby World/Hobby Games 같은 대형 보드게임 출판·유통사가 D&D, Pathfinder, Call of Cthulhu 등 현지화 제품을 공급하는 것이 확인된다.

중요 신호:

- Hobby World는 동유럽권 대형 보드게임 출판/유통사로 소개된다.
- 러시아어 D&D 스타터 세트와 관련 제품이 공식 유통되고 있다.
- Chaosium은 Call of Cthulhu 러시아어판을 발표한 바 있다.
- 러시아어권 TRPG 커뮤니티는 D&D, Pathfinder, CoC, 온라인 세션, 현지 커뮤니티를 중심으로 존재한다.

제품 함의:

- 현지어 번역과 공식 유통이 플레이 저변 확대에 중요하다.
- 러시아권처럼 로컬 언어 장벽이 큰 시장에서는 "영어권 룰 그대로"보다 로컬라이징된 UX와 룰 설명이 필요하다.
- 글로벌 AI GM을 만들려면 룰북 언어보다 "룰셋을 구조화한 중립 schema"가 우선이다.

### 유럽

유럽은 하나의 시장이 아니다. 독일, 프랑스, 북유럽, 영국, 이탈리아, 스페인, 폴란드 등 각 지역의 언어권과 출판사가 다르다.

중요 신호:

- 독일: The Dark Eye / Das Schwarze Auge는 독일 판타지 TRPG의 대표 사례다. 장기 메타플롯, 방대한 세계관, 자국어 출판 생태계가 강하다.
- 스웨덴/북유럽: Free League는 Year Zero Engine, Vaesen, Alien RPG, The One Ring, Dragonbane, Mork Borg 등으로 국제적 존재감이 크다.
- Nordic Larp: 승패보다 감정, 협력, 안전, debrief, bleed 관리, 디자인된 경험을 중시한다.
- 프랑스: 다수의 자국 RPG와 번역 시장이 존재하고, 문학적/예술적/실험적 접근이 상대적으로 눈에 띈다.
- 영국: Warhammer Fantasy Roleplay, Fighting Fantasy, Dragon Warriors 등 게임북/다크 판타지/전술적 판타지 계보가 있다.

제품 함의:

- 장기 세계관형 게임은 "Front/Metaplot/Timeline" 저장이 중요하다.
- 북유럽식 설계는 AI GM에도 safety, debrief, 감정 강도 조절, consent가 필요하다는 근거가 된다.
- Free League/Year Zero류는 survival, stress, push, condition 같은 상태 변화가 핵심이므로 Living Character Sheet와 궁합이 좋다.
- 유럽 확장을 생각한다면 영어 하나로 충분하지 않다. 로컬 룰/로컬 언어/로컬 문화권을 분리해야 한다.

### 아프리카

아프리카 TRPG 시장은 공개 통계가 적고, "아프리카"라는 단일 문화권으로 묶으면 부정확하다. 따라서 이 문서는 시장 규모를 단정하지 않고, 확인 가능한 프로젝트와 커뮤니티 신호만 정리한다.

중요 신호:

- 남아공에는 D&D/테이블탑 커뮤니티와 Comic Con Africa TRPG 이벤트 사례가 있다.
- Nyambe는 OGL/d20 기반 아프리카 신화 판타지 설정으로 출간된 사례다.
- The Wagadu Chronicles는 아프로판타지 세계관을 MMO와 5e 호환 tabletop lorebook으로 연결하려 한 사례다. MMO는 중단되었지만, tabletop/세계관 관점에서는 여전히 중요한 참고점이다.
- Kalymba, Zairoo 같은 아프리카 기반 또는 Pan-African fantasy 프로젝트가 존재한다.
- 아프리카 기반 콘텐츠는 "신화 소재를 가져다 쓰는 것"이 아니라, 제작자/커뮤니티의 관점과 문화적 맥락을 존중해야 한다.

제품 함의:

- 지역 신화/민속을 AI가 자동 생성하게 할 때 문화적 오용 위험이 크다.
- "아프리카풍" 같은 태그는 너무 거칠다. Yoruba, Maasai, Mali, Ghana, Congo, South Africa 등 구체적 문화권과 창작자 관점을 분리해야 한다.
- 글로벌 UGC를 열 경우 문화권 태그, 민감도 태그, 출처/영감 표기, 커뮤니티 신고/검수 체계가 필요하다.

### 브라질 / 남미 보완 사례

브라질은 글로벌 TRPG 조사에서 반드시 볼 가치가 있다. Tormenta는 현지 잡지, 판타지 IP, d20, 크라우드펀딩, 소설/만화/게임 확장으로 성장한 대표 자국 TRPG다.

중요 신호:

- Tormenta는 Dragao Brasil 잡지에서 출발해 Jambo Editora의 대표 판타지 RPG IP로 성장했다.
- Roll20 Marketplace는 Tormenta를 브라질에서 가장 인기 있는 판타지 RPG로 소개한다.
- Tormenta20은 브라질 크라우드펀딩에서 큰 성공을 거둔 사례로 반복 언급된다.

제품 함의:

- 자국어 콘텐츠와 팬덤 IP가 충분히 강하면 D&D가 아닌 현지 게임도 강한 시장 지위를 가질 수 있다.
- UGC는 그냥 에디터를 열어서 생기는 것이 아니라, 잡지/리플레이/소설/커뮤니티/공식 설정이 함께 돌아가는 콘텐츠 생태계에서 성장한다.

### 남아시아 / 디아스포라 보완 사례

Desis & Dragons 같은 남아시아 중심 커뮤니티 사례는 "대표성"과 "안전한 커뮤니티"가 TRPG 입문에 얼마나 중요한지 보여준다. D&D 하나만 가르치는 것이 아니라, 다양한 룰과 테마를 소개하는 커뮤니티 방식도 참고할 만하다.

제품 함의:

- AI GM은 문화적 배경을 장식처럼 쓰면 안 된다.
- 소수자/디아스포라/지역 커뮤니티를 위한 테이블 안전과 표현 가이드가 필요하다.
- 제품이 특정 문화권을 다룰 때는 "자료 수집"만으로 충분하지 않고, 해당 문화권 창작자와 플레이어의 검수가 필요하다.

## 주요 룰 계보와 AI GM 설계 영향

### d20 / D&D / Pathfinder

특징:

- 클래스, 레벨, HP, AC, 전투 액션, 주문, 아이템, 전술적 성장.
- 네트워크 효과가 강하고 입문 자료가 많다.
- 규칙과 예외가 많아 자동화 비용이 크다.

AI GM 함의:

- 완전 자동 전투는 비용이 크다.
- 초반 MVP에는 d20 풀오토보다 서사적 판정 중심이 더 현실적이다.
- d20 계열을 지원하려면 캐릭터 빌드/조건/주문/액션 경제를 엄밀히 모델링해야 한다.

### BRP / Call of Cthulhu / RuneQuest

특징:

- d100 skill 기반.
- 캐릭터는 영웅적 슈퍼히어로보다 취약한 개인인 경우가 많다.
- CoC는 조사, 단서, 정신적 붕괴, 공포, 시대/직업 기반 캐릭터성이 중요하다.
- RuneQuest는 Glorantha 세계관과 문화/종교/신화의 밀도가 높다.

AI GM 함의:

- 조사극에는 단서 그래프와 Three Clue Rule이 필수다.
- 캐릭터 직업, 신념, 공포 반응, 인간관계가 판정보다 중요하게 쓰일 수 있다.
- 상태 변화는 HP보다 sanity, trauma, clue ownership, suspicion, obsession 같은 심리/정보 상태가 중요하다.

### Fudge / Fate / EZFudge

특징:

- 수치가 작고 형용사 ladder와 tag/aspect가 서사에 잘 붙는다.
- 범용 룰로 빠르게 장르를 바꾸기 좋다.
- Fate류는 aspect가 캐릭터 hook과 직접 연결된다.

AI GM 함의:

- EZFudge는 MVP용 범용 엔진으로 적합하다.
- 다만 모든 게임을 `attributes` 몇 개로 평평하게 합치면 TRPG의 맛이 사라진다.
- `aspect`, `tag`, `trouble`, `bond`, `goal` 같은 서사 필드를 Character Sheet에 보존해야 한다.

### PbtA / Dungeon World / Monster of the Week

특징:

- Fiction first.
- 플레이어 move, GM agenda, GM principles, GM moves가 절차를 만든다.
- 10+/7-9/6- 결과 구조가 실패를 단순 정지가 아니라 새 전개로 만든다.

AI GM 함의:

- AI GM은 "무엇을 말할지"보다 "어떤 GM move를 적용할지"를 먼저 결정해야 한다.
- 실패 결과는 "못 했다"가 아니라 위협 진전, 대가, 선택지, 새 정보로 바뀌어야 한다.
- 레디체크 하이브리드와 PbtA의 자유 흐름은 충돌할 수 있으므로 라운드 단위로 move를 묶는 adapter가 필요하다.

### Forged in the Dark / Blades in the Dark

특징:

- position/effect, stress, resistance, flashback, crew, faction, clock.
- 진행 clock은 장애물과 임박한 위험을 명시적으로 추적한다.

AI GM 함의:

- Progress Clock은 캐릭터 개인 목표, 관계, 추적, 오염, 공포, 조사 진척에 확장한다.
- AI가 clock을 임의로 올리지 않도록 서버가 허용 조건을 검증해야 한다.

### Year Zero Engine / Free League

특징:

- attribute + skill dice pool, push, condition, resource, survival pressure.
- Alien, Vaesen, Forbidden Lands, Tales from the Loop 등 장르별 변형이 많다.

AI GM 함의:

- condition과 resource가 캐릭터 상태의 핵심이다.
- 장면의 압력과 캐릭터 소모가 누적되어야 재미가 난다.
- Living Character Sheet의 `conditions`, `resources`, `stress`, `injuries` 설계 참고로 좋다.

### OSR / NSR

특징:

- 규칙보다 ruling, 탐험 절차, 위험한 던전, 자원 관리, 플레이어의 실제 문제 해결을 중시한다.
- 캐릭터 서사보다 상황/지도/위험/선택이 우선되는 경우가 많다.

AI GM 함의:

- AI가 힌트를 과잉 제공하면 OSR 재미가 죽는다.
- 지도, 시간, 횃불, 소모품, 소음, 적 반응, 방황 몬스터 같은 절차 상태가 필요하다.
- 플레이어가 낸 해결책을 유연하게 판정하는 engine이 중요하다.

### Nordic Larp / 감정 중심 설계

특징:

- 승패보다 경험, 감정, 관계, 안전, debrief를 중시한다.
- bleed, consent, alibi, calibration 같은 개념이 중요하다.

AI GM 함의:

- Safety Profile은 선택 기능이 아니라 장르 확장에 필요한 기반이다.
- 세션 종료 후 요약만이 아니라 감정 debrief, tone wrap-up, 다음 세션 동의 확인이 필요하다.
- AI가 강한 감정 장면을 만들 때는 플레이어의 허용 범위와 중단 신호를 알아야 한다.

## AI-TRPG 서비스에 필요한 제품 구조

### 1. Game Profile Schema

모든 룰을 하나의 `attributes` 구조로 밀어 넣지 말고, 룰셋별 profile을 둬야 한다.

```ts
type GameProfile = {
  gameId: string;
  title: string;
  origin?: string;
  rulesFamily: "ezfudge" | "d20" | "brp" | "pbta" | "fitd" | "yze" | "osr" | "card" | "custom";
  sessionStyle: "dungeon" | "investigation" | "horror" | "drama" | "comedy" | "survival" | "relationship" | "sandbox";
  characterSchemaId: string;
  stateSchemaId: string;
  resolutionSchemaId: string;
  gmPrinciples: string[];
  gmMoves: string[];
  safetyDefaults: string[];
  memoryPolicy: "one-shot" | "short-campaign" | "long-campaign";
  replayStyle?: "plain-summary" | "actual-play-log" | "light-novel-replay" | "session-report";
};
```

### 2. Character Sheet와 Character State 분리

정적 시트:

- 이름, 컨셉, 룰셋별 원본 필드
- 성격, 목표, 결점, bond, ideal, flaw, secret
- 말투, 금기, 관계, 배경
- 선택 카드, playbook, class, occupation

동적 상태:

- condition, injury, stress, sanity, corruption, fatigue
- inventory, clue ownership, resources
- relationship attitude, faction reputation
- personal clock, promise, unresolved hook

### 3. Scenario Blackboard

시나리오는 단순 opening text가 아니라 구조화된 blackboard가 필요하다.

- Scene Node: 현재 장면의 장소, 목적, 압력, 진입/종료 조건.
- Clue Graph: 알아야 할 결론과 그 결론으로 가는 복수 단서.
- Front/Threat: 방치하면 진행되는 위험과 clock.
- NPC State: 욕망, 공포, 태도, 알고 있는 정보, 거짓말.
- Ending Paths: 성공, 실패, 대가 있는 성공, 열린 결말.

### 4. Replay Export

일본 리플레이 문화와 actual play 성장 사례를 보면, 세션 후 결과물은 제품 기능이다.

필요 기능:

- 플레이어별 주요 발언과 행동 요약.
- GM 내레이션 중 명장면 추출.
- 캐릭터별 변화 요약.
- "다음 화 예고"식 hook.
- 공유 가능한 짧은 카드/이미지/텍스트.
- 원문 로그와 편집된 리플레이의 분리.

### 5. Safety Profile

Safety Profile은 다음을 포함해야 한다.

- 금지 주제 lines.
- 흐리게 처리할 주제 veils.
- 공포/고어/성적/정치적/차별적 묘사 강도.
- 중단 신호.
- 세션 종료 debrief 여부.
- 플레이어별 비공개 선호와 테이블 전체 공개 선호의 분리.

## 우리 프로젝트에 대한 직접 권고

### 우선순위 1: Living Character Sheet

이전 문서의 결론을 유지한다. 글로벌 TRPG 자료를 넓게 봐도, 캐릭터 시트와 상태 변화를 AI가 제대로 쓰지 못하면 어떤 룰을 붙여도 "그럴듯한 채팅"을 넘기 어렵다.

해야 할 일:

- `Character.sheetData` 또는 동등 구조 추가.
- `CharacterState` 추가.
- 룰셋별 schema 보존.
- AI `characterDeltas` 제안 -> 서버 검증 -> 적용 -> 다음 컨텍스트 반영.
- 세션 로그와 캐릭터 상태 변경을 분리 저장.

### 우선순위 2: 조사/호러 원샷 템플릿 추가

현재 MVP의 던전 원샷은 엔진 검증에는 좋지만, 한국/일본/중국권 신호를 보면 조사/호러 원샷 템플릿이 필요하다.

단, Call of Cthulhu IP를 그대로 쓰지 말 것. 원본 cosmic horror나 한국형 괴담/폐건물/민속 미스터리 같은 자체 시나리오로 구현해야 한다.

필요 구조:

- 단서 3개 이상으로 하나의 결론을 지지.
- NPC별 숨기는 정보와 드러내는 정보.
- 공포 clock 또는 진실 접근 clock.
- sanity를 직접 베끼지 말고 `strain`, `fear`, `obsession` 같은 자체 상태로 설계.
- 엔딩은 성공/실패보다 "무엇을 알고 어떤 대가를 치렀는가" 중심.

### 우선순위 3: Replay/Session Report 자동 생성

한국어 서비스의 바이럴과 회고 경험을 위해 세션 종료 후 다음 산출물을 만들자.

- 1분 요약.
- 캐릭터별 하이라이트.
- 명대사/명장면.
- 바뀐 캐릭터 상태.
- 다음 세션 hook.
- 공유용 짧은 카드.

### 우선순위 4: Game Profile 기반 룰 확장

EZFudge를 기본 엔진으로 유지하되, 모든 콘텐츠를 EZFudge로 환원하지 말자.

확장 순서:

1. EZFudge fantasy dungeon.
2. EZFudge investigation/horror.
3. PbtA-style fiction-first adapter.
4. FitD-style clock/stress adapter.
5. BRP-like d100 investigation adapter.
6. d20는 마지막에 제한적으로 검토.

### 우선순위 5: Safety와 Tone Governor

호러/감정극/민속 소재를 다루려면 safety가 필요하다. AI 서비스는 인간 GM보다 더 쉽게 선을 넘을 수 있으므로, session state에 safety를 넣어야 한다.

## Fable 5에게 추가로 줄 조사 기반 프롬프트

```md
`fix_and_add/global_trpg_research_2026-07-01.md`를 읽고, 현재 AI-TRPG 서비스가 서구식 던전 원샷에만 갇히지 않도록 구조를 설계하라.

이번 구현 우선순위는 다음이다.

1. Living Character Sheet를 먼저 구현한다.
2. 그 다음 조사/호러 원샷을 지원할 수 있는 Scenario Blackboard 구조를 설계한다.
3. 모든 룰을 EZFudge `attributes`로 평평하게 합치지 말고 Game Profile / Character Schema / State Schema / Resolution Schema를 분리한다.
4. AI GM 출력은 대본 생성이 아니라 GM move, clue reveal, clock advance, character delta proposal을 구조화해서 서버에 제안해야 한다.
5. 서버가 적용한 상태만 다음 라운드의 확정 사실로 AI에 전달한다.
6. 세션 종료 후 replay/session report를 자동 생성할 수 있도록 로그와 요약 구조를 정리한다.

하지 말 것:

- Call of Cthulhu, D&D, Sword World, The Dark Eye 등 상용 룰/세계관을 무단 복제하지 말 것.
- 특정 문화권 신화나 민속을 얕게 긁어와 자동 생성하지 말 것.
- D&D식 전투 자동화부터 시작하지 말 것.
- 시나리오 수만 늘려서 문제를 해결하려 하지 말 것.
```

## 출처와 참고 링크

### 일반 역사/정의/연구

- MIT Press - Jon Peterson, The Elusive Shift: https://mitpress.mit.edu/9780262544900/the-elusive-shift/
- Wired - Playing at the World interview: https://www.wired.com/2012/09/new-d-d-history-book
- Analog Game Studies - Uncertainty in Analog RPGs: https://analoggamestudies.org/2014/08/uncertainty-in-analog-role-playing-games-part-1/
- Scoping Review of TTRPG as intervention/support: https://pmc.ncbi.nlm.nih.gov/articles/PMC11299717/
- Monte Cook - Shared Imaginary Space: https://montecook.substack.com/p/shared-imaginary-space

### 미국/영어권/온라인 플랫폼

- D&D Beyond SRD v5.2.1: https://www.dndbeyond.com/srd
- D&D Beyond Basic Rules 2014: https://www.dndbeyond.com/sources/dnd/basic-rules-2014
- Pathfinder 2e official SRD reference via Archives of Nethys: https://2e.aonprd.com/Rules.aspx
- Paizo Pathfinder getting started: https://paizo.com/pathfinder/getstarted
- Roll20 Orr Report archive: https://wiki.roll20.net/Orr_Industry_Report
- Roll20 8 million users report: https://blog.roll20.net/posts/the-orr-group-industry-report-q4-2020-8-million-users-edition/
- Roll20 current platform page: https://roll20.net/
- Foundry VTT: https://foundryvtt.com/
- StartPlaying 2024 popular games: https://startplaying.games/blog/posts/the-most-popular-ttrpgs-on-startplaying-games-in-2024
- ICv2 2024 hobby games market: https://icv2.com/articles/markets/view/59119/2024-was-year-stabilization-hobby-games-market
- ICv2 2024 Player's Handbook sales: https://icv2.com/articles/news/view/57876/2024-players-handbook-becomes-fastest-selling-dungeons-dragons-product-ever

### 룰 계보/SRD

- Chaosium BRP SRD: https://www.chaosium.com/brp-system-reference-document/
- Fate SRD: https://fate-srd.com/
- Fate Creative Commons guide: https://fate-srd.com/official-licensing-fate/cc
- Apocalypse World / PbtA: https://apocalypse-world.com/
- Lumpley Games - Powered by the Apocalypse: https://lumpley.games/2019/12/30/powered-by-the-apocalypse-part-1/
- Dungeon World SRD - Gamemastering: https://www.dungeonworldsrd.com/gamemastering/
- Dungeon World SRD - Fronts: https://www.dungeonworldsrd.com/gamemastering/fronts/
- Blades in the Dark - Progress Clocks: https://bladesinthedark.com/progress-clocks
- Blades in the Dark - Effect: https://bladesinthedark.com/effect
- Free League Year Zero Engine license/SRD: https://freeleaguepublishing.com/community-content/free-tabletop-licenses/
- Free League Powered by Year Zero: https://freeleaguepublishing.com/powered-by-year-zero/
- Free League Vaesen: https://freeleaguepublishing.com/games/vaesen/
- Mork Borg: https://morkborg.com/

### 일본

- A Short History of Table-Talk and Live-Action Role-Playing in Japan: https://journals.sagepub.com/doi/abs/10.1177/1046878119879738
- TokyoDev - The rise and fall of D&D in Japan: https://www.tokyodev.com/articles/the-rise-and-fall-of-dnd-in-japan
- Gnome Stew - Japanese Tabletalk RPG observations: https://gnomestew.com/10-things-i-learned-about-japanese-tabletalk-rpgs/
- Polygon - Sword World coming west: https://www.polygon.com/sword-world-rpg-japan-dnd-actual-play/
- Sword World official English-facing site: http://swordworldrpg.com/

### 한국

- 아주경제 - D&D 한국어판 펀딩 기사: https://www.ajunews.com/view/20190629101336331
- 톱데일리 - D&D 한국어판 펀딩 기사: https://www.topdaily.kr/articles/25889
- 한국 TRPG의 역사 정리: https://trpgkorea.fandom.com/wiki/%ED%95%9C%EA%B5%AD_TRPG%EC%9D%98_%EC%97%AD%EC%82%AC
- DriveThruRPG Korean language browse: https://www.drivethrurpg.com/en/browse?languages=100092-korean

### 중국

- Pelgrane Press - TRPG and Cthulhu culture in China: https://pelgranepress.com/2018/05/02/a-tale-of-two-secret-cults-a-brief-introduction-to-trpg-and-cthulhu-culture-in-china/
- Gcores - CoC/Chaosium history article: https://www.gcores.com/articles/127079
- Gcores - 跑团 as weekend game article: https://www.gcores.com/articles/163026
- Chinese Moegirl TRPG overview: https://zh.moegirl.org.cn/%E6%A1%8C%E4%B8%8A%E8%A7%92%E8%89%B2%E6%89%AE%E6%BC%94%E6%B8%B8%E6%88%8F
- Cthulhu Club China CoC intro: https://www.cthulhuclub.com/call-of-cthulhu-trpg/
- TRPG Engine docs: https://trpgdoc.moonrailgun.com/docs/introduce

### 러시아/동유럽

- Hobby Games D&D category: https://hobbygames.ru/dungeons-and-dragons-category
- Hobby World Russian D&D starter: https://hobbyworld.ru/dungeons-and-dragons-startovij-nabor
- Hobby World International company page: https://hobbyworldint.com/
- Chaosium Russian Call of Cthulhu announcement: https://www.chaosium.com/bloga-new-russian-edition-of-call-of-cthulhu/
- Rusbase D&D Russian release: https://rb.ru/stories/dungeons-dragons-russian/

### 유럽

- Ulisses US - The Dark Eye: https://ulisses-us.com/games/tde/
- Kickstarter - The Dark Eye English Edition: https://www.kickstarter.com/projects/ulissesspiele/the-dark-eye-rpgenglish-edition
- Free League Publishing: https://freeleaguepublishing.com/
- Free League Dragonbane/Swedish RPG context article: https://www.polygon.com/tabletop-games/497774/helldivers-2-inspired-by-dnd-dragonbane-free-league
- Nordic Larp - Bleed: https://www.nordiclarp.org/2015/03/02/bleed-the-spillover-between-player-and-character/
- Analog Game Studies - Nordic Larp tag: https://analoggamestudies.org/tag/nordic-larp/
- Wired - Nordic larp example: https://www.wired.com/story/my-4-days-in-fake-gay-conversion-therapy-nordic-larp
- The New Yorker - LARPing Goes to Disney World: https://www.newyorker.com/magazine/2022/05/30/larping-goes-to-disney-world

### 아프리카

- Comic Con Africa TRPG event: https://www.unplugyourself.co.za/tabletop-roleplaying-comic-con-africa-with-dum-dum-die/
- Atlas Games - Nyambe: https://atlas-games.com/nyambe
- The Wagadu Chronicles overview: https://www.mmorpg.com/the-wagadu-chronicles
- MMOs.com Wagadu review/status: https://mmos.com/review/the-wagadu-chronicles
- Kalymba Kickstarter: https://www.kickstarter.com/projects/craftandogames/kalymba-roleplaying-game
- Zairoo: https://zairoo.com/
- Dungeons and Dragons ZA: https://www.dungeonsanddragons.co.za/

### 브라질/남미

- Jambo Editora: https://jamboeditora.com.br/
- Roll20 Tormenta20 Introductory Kit: https://marketplace.roll20.net/browse/module/19562/tormenta20-introductory-kit
- RPGista - Brazilian RPG Scene: https://rpgista.com.br/2019/03/17/a-history-of-the-brazilian-rpg-scene/
- Rascal - Jambo/Editora context: https://www.rascal.news/severe-flooding-endangers-brazils-largest-ttrpg-publisher/
- Koboa Kickstarter: https://www.kickstarter.com/projects/koboa/koboa-the-south-american-5e-setting

### 안전 도구

- TTRPG Safety Toolkit: https://ttrpgsafetytoolkit.com/
- RPGKC Safety Tools: https://www.rpgkc.org/resources/safety-tools
- Golden Lasso Safety Tools: https://goldenlassogames.com/pages/safety-tools
- Analog Game Studies - Larp debriefing: https://analoggamestudies.org/2018/06/post-play-activities-for-larp-methods-and-challenges/

## 신뢰도 메모

- 높은 신뢰: 공식 SRD, 출판사 공식 페이지, 플랫폼 공식 페이지, 학술 논문, 주요 전문 매체.
- 중간 신뢰: 현지 기사, 전문 블로그, 컨벤션/이벤트 페이지, 마켓플레이스 설명.
- 낮은 신뢰: Reddit/Facebook/개인 커뮤니티 관측. 시장 규모 단정에는 쓰지 말고 "커뮤니티 신호"로만 사용한다.
