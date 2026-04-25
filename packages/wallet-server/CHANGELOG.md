# Changelog

## 0.0.13

### Added
- Structured logging via `evlog`. Adds `evlog` as a runtime dependency and installs the `evlog/express` middleware on the Express app, so every request emits one wide event with method, route, status, and duration. Lifecycle events (`server_listening`, `server_shutdown`), dispatch enrichment (rpc method, identityKey, rpc errors), monitor lifecycle (`monitor_starting`, `monitor_started`, `monitor_stopped`), and accounts events (`capacity_exceeded`, `capacity_gate_error`, `auto_internalize_failed`) are all structured. Default destination is stdout (NDJSON), captured by whatever supervisor runs the process. Replaces ad-hoc `console.error` calls in the accounts capacity gate.
