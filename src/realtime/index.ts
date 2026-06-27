/**
 * Realtime layer: the WebSocket gateway (Realtime_Channel) and broadcast
 * fan-out.
 *
 * Exposes the transport-agnostic {@link Connection} port + {@link ServerEvent}
 * envelope, the {@link RealtimeGateway} that owns connection lifecycle,
 * broadcast, chat retry, heartbeat, and narration buffering, and the thin `ws`
 * adapter ({@link WsConnection}) used as the production binding.
 */
export * from "./connection.js";
export * from "./gateway.js";
export * from "./ws-connection.js";
export * from "./room-orchestrator.js";
export * from "./engine.js";
