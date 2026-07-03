  import {
    Phase,
    ConnectionStatus,
    MAX_ENTRIES,
    HANDOFF_INVALID_MESSAGE,
    DISCONNECTED_MESSAGE,
    CONNECTION_LOST_MESSAGE,
    DELIVERY_FAILED_MESSAGE,
    SESSION_ENDED_MESSAGE,
    createInitialState,
    parseHandoff,
    buildConnectParams,
    effectivePlayerId,
    eventToAction,
    computeCountdownMs,
    describeCharacterState,
    describeBlackboard,
    buildChatCommand,
    buildConfirmCommand,
    buildPassCommand,
    buildReviseCommand,
    buildRollCheckCommand,
    canRollCheck,
    reduce,
    computeVisibility,
    describeClock,
    rosterModel,
    actionHistoryModel,
    currentPhaseModel,
    readyTally,
    selfStatus,
    actionPermission,
  } from "./logic.js";
  import { createStoryView } from "./views/story.js";
  import { createChecksView } from "./views/checks.js";
  import { createSideView } from "./views/side.js";
  import { createSheetDrawerView } from "./views/sheet-drawer.js";
  import { createPanelsView } from "./views/panels.js";
  import { textSpan, appendText, isNearBottom, stickToBottom, prefersReducedMotion, frand, fsign } from "./views/dom.js";

  const $ = (id) => document.getElementById(id);

  // ---- 고정 간격 재연결 / 카운트다운 주기 (room-lobby와 동형) ------------
  const RECONNECT_INTERVAL_MS = 3000;
  const COUNTDOWN_INTERVAL_MS = 1000;

  // ---- DOM 참조 -----------------------------------------------------------
  const connStatusEl = $("connStatus");
  const roundEl = $("round");
  const phaseEl = $("phase");
  const readyEl = $("ready");
  const countdownEl = $("countdown");
  const busyEl = $("busy");
  const handoffInvalidEl = $("handoffInvalid");
  const clocksEl = $("clocks");
  const charStatesEl = $("charStates");
  const blackboardEl = $("blackboard");
  const storyEl = $("story");
  const newStoryBtn = $("newStoryBtn");
  const sideEl = $("side");
  const msgEl = $("msg");
  const sendBtn = $("sendBtn");
  const passBtn = $("passBtn");
  const reviseBtn = $("reviseBtn");
  const noticeEl = $("notice");
  const checkBar = $("checkBar");
  const rollCountdownEl = $("rollCountdown");
  const checkTray = $("checkTray");
  // 멀티플레이 표시 계층 DOM 참조 (multiplayer-game-ux)
  const turnIndicatorEl = $("turnIndicator");
  const selfStatusEl = $("selfStatus");
  const rosterEl = $("roster");
  const sheetBackdropEl = $("sheetBackdrop");
  const sheetDrawerEl = $("sheetDrawer");
  const sheetDrawerTitleEl = $("sheetDrawerTitle");
  const sheetDrawerSubtitleEl = $("sheetDrawerSubtitle");
  const sheetDrawerBodyEl = $("sheetDrawerBody");
  const sheetRefreshBtn = $("sheetRefreshBtn");
  const sheetCloseBtn = $("sheetCloseBtn");


  // ---- 주입 가능한 부수효과 어댑터 (테스트가 load 이전에 교체 가능) -------
  // window.__gameConnect : connect(roomId, token, handlers) WebSocket 어댑터
  //                        (room-lobby의 window.__lobbyConnect와 동형)
  // window.__gameNow      : Date.now 대체(카운트다운 테스트용, 선택)
  // window.__gameSetInterval / __gameClearInterval : 타이머 주입(선택)
  const now = () => (window.__gameNow ? window.__gameNow() : Date.now());
  const setIntervalImpl = (fn, ms) =>
    (window.__gameSetInterval || window.setInterval).call(window, fn, ms);
  const clearIntervalImpl = (id) =>
    (window.__gameClearInterval || window.clearInterval).call(window, id);
  const HANDOFF_CREDENTIALS_KEY = "ready-gm:handoff";

  function withStoredCredentials(handoff) {
    try {
      const raw = sessionStorage.getItem(HANDOFF_CREDENTIALS_KEY);
      if (!raw) return handoff;
      const stored = JSON.parse(raw);
      if (!stored || stored.roomId !== handoff.roomId) return handoff;
      const viewer = handoff.playerId || handoff.hostPlayerId || "";
      const storedViewer = stored.playerId || stored.hostPlayerId || "";
      if (viewer && storedViewer && viewer !== storedViewer) return handoff;
      return {
        ...handoff,
        hostPlayerId: handoff.hostPlayerId || stored.hostPlayerId || "",
        playerId: handoff.playerId || stored.playerId || "",
        token: handoff.token || stored.token || "",
        ticket: handoff.ticket || stored.ticket || "",
      };
    } catch {
      return handoff;
    }
  }

  // ---- 상태: 단일 진실 원천 ----------------------------------------------
  // 인계는 URL 쿼리에서 식별자만 읽고, 같은 탭의 credential은 sessionStorage에서 합친다.
  const handoff = withStoredCredentials(parseHandoff(location.search));
  let state = createInitialState(handoff);
  // 관전자(본인) 식별자: playerId(캐릭터 화면 인계) 우선, 없으면 hostPlayerId(로비 호스트 인계).
  // /ws URL에 실어 서버가 룸 소속 플레이어로 소켓을 귀속하게 한다(아니면 호스트로 폴백).
  const viewerPlayerId = effectivePlayerId(state.handoff);
  let channel = null;
  let countdownTimer = null;
  let storyView = null;
  let checksView = null;
  let sideView = null;
  let sheetDrawerView = null;
  let panelsView = null;

  // 단방향 흐름: dispatch → reduce → render. render는 상태의 순수 함수다.
  function dispatch(action) {
    state = reduce(state, action);
    render();
  }

  // ---- 렌더 (상태의 함수) -------------------------------------------------
  // 서사·사이드바는 상태 배열을 그대로 다시 그린 뒤 MAX_ENTRIES 상한을 적용한다.
  function render() {
    const v = computeVisibility(state);

    // 인계 무효 안내 (요구사항 1.4)
    handoffInvalidEl.hidden = v.handoffValid;
    if (!v.handoffValid) handoffInvalidEl.textContent = HANDOFF_INVALID_MESSAGE;

    // 연결 상태 표시 (요구사항 2.4, 2.5, 8.1)
    if (v.connectionActive) {
      connStatusEl.textContent = "실시간 연결됨";
      connStatusEl.classList.add("active");
    } else {
      connStatusEl.classList.remove("active");
      // 인계가 유효한데 끊긴 상태면 연결 끊김 안내, 아직 한 번도 연결 전이면 대기 안내.
      if (!v.handoffValid) {
        connStatusEl.textContent = HANDOFF_INVALID_MESSAGE;
      } else if (state.connection === ConnectionStatus.DISCONNECTED && state.turnReceived) {
        connStatusEl.textContent = CONNECTION_LOST_MESSAGE;
      } else {
        connStatusEl.textContent = DISCONNECTED_MESSAGE;
      }
    }

    // 헤더: 라운드 / 단계 (요구사항 5.1)
    roundEl.textContent = state.roundNumber != null ? state.roundNumber : "-";
    phaseEl.textContent = state.phase != null ? state.phase : "-";

    // 헤더: 준비 X/total (요구사항 5.2, 5.3)
    readyEl.textContent = `준비 ${v.ready.ready}/${v.ready.total}`;

    // 헤더: busy 표시 (요구사항 5.5)
    busyEl.hidden = !v.busy;
    if (v.busy) busyEl.textContent = "⏳ GM이 판정/서술 중…";

    // 헤더: 카운트다운 — ready_check일 때만, 잔여 초 표시 (요구사항 5.4)
    const ms = computeCountdownMs(state.readyCheckDeadline, now());
    if (state.phase === Phase.READY_CHECK && ms != null) {
      countdownEl.hidden = false;
      countdownEl.textContent = `남은 시간 ${Math.ceil(ms / 1000)}초`;
    } else {
      countdownEl.hidden = true;
      countdownEl.textContent = "";
    }

    // GM 서사 패널 (요구사항 3.1, 3.3, 3.4) — esc로 이스케이프, 상한 적용, 하단 스크롤
    storyView.renderStory();

    // 진행 시계 게이지 — 노출 시나리오에서만(payload에 clocks가 실릴 때) 표시
    panelsView.renderClocks();

    // 캐릭터 상태(player-visible) — 내용이 있는 캐릭터가 있을 때만 표시
    panelsView.renderCharacterStates();

    // 시나리오 블랙보드(발견 단서/NPC/위협) — 표시할 내용이 있을 때만
    panelsView.renderBlackboard();

    // 채팅 + 행동 로그 사이드바 (요구사항 4.2, 4.3, 6.2, 6.3) — 상한 적용, 하단 스크롤
    sideView.renderSide();
    checksView.renderRollingChecks();

    // 멀티플레이 표시 계층: 단계/차례 · 본인 상태 · 로스터 (multiplayer-game-ux)
    // 기존 단방향 흐름(turn_state/readiness_updated 수신 → reduce → render)에 편승해
    // readiness/phase/activePlayerId/turnOrder/채팅 스냅샷에서 결정적으로 재도출한다.
    panelsView.renderMultiplayer();

    // 전달 실패 / 세션 종료 안내 (요구사항 8.2, 9.3)
    if (v.ended) {
      noticeEl.hidden = false;
      noticeEl.classList.add("ended");
      noticeEl.textContent = SESSION_ENDED_MESSAGE;
    } else if (state.deliveryFailedNotice) {
      noticeEl.hidden = false;
      noticeEl.classList.remove("ended");
      noticeEl.textContent = DELIVERY_FAILED_MESSAGE;
    } else if (state.narrationFailedNotice) {
      // 서사 생성 실패(narration_failed): 침묵 대신 실패와 재시도 방법을 알린다.
      noticeEl.hidden = false;
      noticeEl.classList.remove("ended");
      noticeEl.textContent = state.narrationFailedNotice;
    } else {
      noticeEl.hidden = true;
      noticeEl.classList.remove("ended");
      noticeEl.textContent = "";
    }

    // 입력 컨트롤 비활성 (요구사항 1.4, 7.1, 9.2)
    const disabled = v.inputDisabled;
    msgEl.disabled = disabled;
    sendBtn.disabled = disabled;
    passBtn.disabled = disabled;
    reviseBtn.disabled = disabled;
  }


  // ---- 멀티플레이 파생 입력 (turn_state 형태 뷰) --------------------------
  // 셀렉터는 turnState({ readiness, chatLog, phase, activePlayerId, turnOrder })를 받는다.
  // reducer state는 채팅을 chatEntries로 보관하므로(동일 모양 { playerId, characterName, ... })
  // chatLog로 매핑해 characterNameFor 폴백이 동작하게 한다.
  function turnStateView() {
    return {
      readiness: state.readiness,
      actionHistory: state.actionHistory,
      chatLog: state.chatEntries,
      phase: state.phase,
      roundNumber: state.roundNumber,
      activePlayerId: state.activePlayerId,
      turnOrder: state.turnOrder,
    };
  }



  // ---- 부수효과: 실시간 채널 (주입 가능한 connect 어댑터 + 재연결) --------
  // 기본 어댑터: /ws 경로로 WebSocket을 열고 onmessage JSON을 eventToAction으로
  // 환원한다. buildConnectParams(roomId, token, viewerPlayerId, ticket).query로 roomId·
  // (있으면)playerId·(있으면)ticket만 전달한다. 글로벌 token은 /ws URL에 싣지 않는다.
  // (auth-hardening: /ws는 ticket으로만 신원 도출)
  // 계약: connect(roomId, token, { onOpen, onMessage, onClose }) -> { send, close }
  function defaultConnect(roomId, token, handlers) {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const { query } = buildConnectParams(roomId, token, viewerPlayerId, handoff.ticket);
    const ws = new WebSocket(`${proto}://${location.host}/ws?${query}`);
    ws.onopen = () => handlers.onOpen();
    ws.onmessage = (ev) => {
      let parsed;
      try {
        parsed = JSON.parse(ev.data);
      } catch {
        return;
      }
      handlers.onMessage(parsed);
    };
    ws.onclose = () => handlers.onClose();
    return {
      send: (obj) => ws.send(JSON.stringify(obj)),
      close: () => ws.close(),
    };
  }

  const connect = window.__gameConnect || defaultConnect;

  function openChannel() {
    channel = connect(state.handoff.roomId, state.handoff.token, {
      onOpen: () => {
        // 연결이 열리면 대기 중인 재연결 예약을 취소한다(중복 재연결 방지).
        if (reconnectTimerId != null) {
          clearTimeout(reconnectTimerId);
          reconnectTimerId = null;
        }
        dispatch(eventToAction({ type: "connection-open" }));
      },
      onMessage: (parsed) => {
        const action = eventToAction(parsed);
        if (action) dispatch(action);
        if (parsed && parsed.type === "checks_pending") {
          checksView.clearAnimatedServerCheckIds();
        }
        if (parsed && parsed.type === "check_rolled") {
          checksView.animateRolledCheck(parsed.check);
        }
        // 서버가 굴린 이번 라운드 판정을 "운명" 주사위로 연출(visibility=player만).
        // 결과는 resolution 내레이션 payload의 checks로 전달된다.
        if (parsed && parsed.type === "narration" && parsed.narration) {
          checksView.maybeAnimateChecks(parsed.narration.checks);
        }
      },
      onClose: () => {
        dispatch(eventToAction({ type: "connection-lost" }));
        scheduleReconnect();
      },
    });
  }

  // 대기 중인 재연결 예약 id. close가 연달아 와도 재연결은 한 번만 예약된다.
  let reconnectTimerId = null;

  function scheduleReconnect() {
    // 종료된 세션은 재연결하지 않는다(요구사항 9.4).
    if (state.ended) return;
    // 이미 재연결이 예약되어 있으면 새로 쌓지 않는다(타이머 중복 방지).
    if (reconnectTimerId != null) return;
    reconnectTimerId = setTimeout(() => {
      reconnectTimerId = null;
      if (!state.ended) openChannel();
    }, RECONNECT_INTERVAL_MS);
  }

  // ---- 카운트다운 타이머 (1초 간격 재렌더) (요구사항 5.4) ----------------
  function startCountdownTimer() {
    if (countdownTimer != null) return;
    countdownTimer = setIntervalImpl(() => {
      // 세션 종료 시 타이머를 멈춘다.
      if (state.ended) {
        stopCountdownTimer();
        return;
      }
      render();
    }, COUNTDOWN_INTERVAL_MS);
  }

  function stopCountdownTimer() {
    if (countdownTimer != null) {
      clearIntervalImpl(countdownTimer);
      countdownTimer = null;
    }
  }

  // ---- 명령 전송 가드 ------------------------------------------------------
  // 입력 잠금/종료/미연결이면 전송하지 않고 로컬 에코도 dispatch 하지 않는다
  // (요구사항 7.3, 8.4).
  function canSend() {
    return !computeVisibility(state).inputDisabled && state.connection === ConnectionStatus.OPEN;
  }

  // 단계별 행동 제출 권한(actionPermission)을 현재 상태에서 도출한다.
  // canSend()(입력 잠금·연결 가드)와 AND로 결합해 명령별로 게이팅한다(요구사항 3.2, 3.4).
  function permission() {
    return actionPermission(
      {
        phase: state.phase,
        readiness: state.readiness,
        activePlayerId: state.activePlayerId,
      },
      viewerPlayerId,
    );
  }

  // 커맨드를 전송하고 성공 여부를 반환한다. 채널이 없거나 send가 던지면 false를
  // 반환하고 전달 실패 안내를 즉시 표시한다 — 호출자는 실패 시 로컬 에코를
  // dispatch하지 않아 화면과 서버 상태가 갈라지지 않는다.
  function sendCommand(cmd) {
    try {
      if (!channel) throw new Error("no channel");
      channel.send(cmd);
      return true;
    } catch {
      dispatch({ type: "DELIVERY_FAILED", failedType: "send" });
      return false;
    }
  }

  // ---- 사용자 동작 배선 ---------------------------------------------------
  // 입력 해석: 따옴표(" " 또는 “ ”) 안은 대사(채팅), 나머지는 행동(확정)으로 보낸다.
  function parseUtterance(text) {
    const quoteRe = /["“”]([^"“”]*)["“”]/g;
    const says = [];
    let m;
    while ((m = quoteRe.exec(text)) !== null) {
      const s = m[1].trim();
      if (s) says.push(s);
    }
    const action = text.replace(quoteRe, " ").replace(/\s+/g, " ").trim();
    return { says, action };
  }

  // 보내기: 대사("")는 채팅으로(서버가 echo), 행동은 확정으로 전송 + 본인 로컬 에코.
  function submit() {
    if (!canSend()) return;
    const perm = permission();
    const text = msgEl.value.trim();
    if (!text) return;
    const { says, action } = parseUtterance(text);
    // 말하기: canChat이 허용할 때만 전송한다(요구사항 3.4).
    for (const s of says) {
      if (!perm.canChat) break;
      const c = buildChatCommand(s);
      if (c) sendCommand(c);
    }
    const confirmText = action || (says.length === 0 ? text : "");
    // 행동 확정: canConfirm이 허용할 때만 전송 + 로컬 에코한다(불허면 둘 다 안 함, 요구사항 3.4).
    if (confirmText && perm.canConfirm) {
      const c = buildConfirmCommand(confirmText);
      // 전송이 실제로 성공했을 때만 로컬 에코를 남긴다(실패 시 화면-서버 불일치 방지).
      if (c && sendCommand(c)) {
        dispatch({ type: "CONFIRM_ACTION", playerId: viewerPlayerId, action: c.action });
      }
    }
    msgEl.value = "";
  }

  sendBtn.addEventListener("click", submit);

  // 패스: 전송 + 본인 로컬 에코 (요구사항 6.3) — canPass 게이팅(요구사항 3.4)
  passBtn.addEventListener("click", () => {
    if (!canSend()) return;
    if (!permission().canPass) return;
    // 전송이 실제로 성공했을 때만 로컬 에코를 남긴다(실패 시 화면-서버 불일치 방지).
    if (sendCommand(buildPassCommand())) {
      dispatch({ type: "PASS", playerId: viewerPlayerId });
    }
  });

  // 수정: 전송만(서버 readiness로 반영) (요구사항 6.4) — canRevise 게이팅(요구사항 3.4)
  reviseBtn.addEventListener("click", () => {
    if (!canSend()) return;
    if (!permission().canRevise) return;
    const cmd = buildReviseCommand(msgEl.value);
    if (cmd) {
      sendCommand(cmd);
      msgEl.value = "";
    }
  });

  // Enter 키로 보내기 (요구사항 11.3)
  msgEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
  });


  // ---- 판정 결과 "운명" 주사위 연출 (ai.html 포팅) -----------------------


  const getState = () => state;
  const getViewerPlayerId = () => viewerPlayerId;
  const viewCtx = {
    els: {
      clocksEl,
      charStatesEl,
      blackboardEl,
      storyEl,
      newStoryBtn,
      sideEl,
      checkBar,
      rollCountdownEl,
      checkTray,
      turnIndicatorEl,
      selfStatusEl,
      rosterEl,
      sheetBackdropEl,
      sheetDrawerEl,
      sheetDrawerTitleEl,
      sheetDrawerSubtitleEl,
      sheetDrawerBodyEl,
      sheetRefreshBtn,
      sheetCloseBtn,
    },
    helpers: {
      textSpan,
      appendText,
      isNearBottom,
      stickToBottom,
      prefersReducedMotion,
      frand,
      fsign,
      now,
      turnStateView,
    },
    getState,
    sendCommand,
    getViewerPlayerId,
    dispatch,
  };
  sheetDrawerView = createSheetDrawerView(viewCtx);
  viewCtx.openSheetDrawer = sheetDrawerView.openSheetDrawer;
  storyView = createStoryView(viewCtx);
  checksView = createChecksView(viewCtx);
  sideView = createSideView(viewCtx);
  panelsView = createPanelsView(viewCtx);

  // ---- 부팅 ---------------------------------------------------------------
  render();
  // 인계가 유효할 때만 채널을 연다(무효면 안내만 표시, 요구사항 1.3/1.4).
  if (state.handoffValid) {
    openChannel();
    startCountdownTimer();
  }

  // 주사위 패널 배선: 세션 중 직접 굴리는 다이스 롤러. 기존 게임 로직과 독립적인
  // 별도 모듈로 두어 부수효과 계층(채널/리듀서) 테스트와 간섭하지 않는다.
  import { createDiceTray } from "./dice-tray.js";

  const trayEl = document.getElementById("diceTray");
  const resultEl = document.getElementById("diceResult");
  if (trayEl) {
    const tray = createDiceTray(trayEl);
    const diceButtons = Array.from(document.querySelectorAll(".dice-panel button"));

    const setBusy = (busy) => {
      for (const b of diceButtons) b.disabled = busy;
    };
    const summarize = (plans) => {
      const parts = plans.map((p) => {
        const tag =
          p.criticality === "crit" ? " (대성공!)" : p.criticality === "fumble" ? " (대실패!)" : "";
        return `${p.label ? p.label + " " : ""}d${p.sides} → ${p.result}${tag}`;
      });
      const total = plans.reduce((s, p) => s + p.result, 0);
      resultEl.replaceChildren(document.createTextNode("결과: "));
      parts.forEach((part, index) => {
        if (index > 0) appendText(resultEl, " · ");
        const strong = document.createElement("b");
        strong.textContent = part;
        resultEl.appendChild(strong);
      });
      if (plans.length > 1) appendText(resultEl, ` (합계 ${total})`);
    };
    const run = async (specs) => {
      setBusy(true);
      resultEl.textContent = "굴리는 중…";
      try {
        summarize(await tray.rollSequence(specs));
      } finally {
        setBusy(false);
      }
    };

    for (const b of document.querySelectorAll(".dice-panel .die-btn")) {
      b.addEventListener("click", () => run([{ sides: Number(b.getAttribute("data-sides")) }]));
    }
    const critBtn = document.getElementById("diceCritBtn");
    if (critBtn) {
      critBtn.addEventListener("click", () =>
        run([
          { sides: 6, speed: "fast", label: "보너스" },
          { sides: 20, speed: "slow", emphasis: true, label: "운명의 판정" },
        ]),
      );
    }
    const clearBtn = document.getElementById("diceClearBtn");
    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        tray.clear();
        resultEl.textContent = "";
      });
    }
  }