# Fable review of the StorageKnex / mounted StorageServer work (2026-10-01)

Raw findings from the independent review; worked through one at a time with the user.
Status column tracks resolution.

See conversation for the full text; summary of open items, in priority order:

1. BLOCKER: bopen.1 includes #723, whose migration adds the sync_states unique constraint the conversion SQL already keeps -> StorageKnex.migrate fails on production. Drop #723, republish from #719 + #722.
2. Security: yours-wallet ADMIN_ORIGINATOR = bare chrome.runtime.id can be matched by a page on a dotless hostname equal to the extension id; isAdmin must come from sender.origin only.
3. #722 not minimal: drop publicRoutes, start() guard, release metadata, 3 of 4 tests.
4. #719 not minimal: CONCURRENTLY machinery, adminStats rewrite, reqReviewQuery extraction, knexPostgres monkeypatch in StorageKnex, MonitorDaemon/Setup/operator additions, recoverable flag, release metadata/doc regeneration, allocateChangeInput loop for all dialects.
5. 1sat-sdk storageRpc.ts: drop logging + telemetry sink, justify or drop maxRpcListLimit 10000, align @types/express 5 instead of casts, keep dbtype shim only with removal condition.
6. redisSessionManager: collapse to createAuthSessions -> { sessionManager, hydrate }.
7. peerDependencies must not use the npm alias; alias only in cli deps + root overrides.
8. Toolbox JSON body limit (8 MiB) now applies to RPC instead of host's 30 MB.
9. Signing fix: permission-module can no longer auto-grant template unlocks (sees only the hash).
10. yours-wallet reconcile: ~reconcile pseudo-identity leaves sync_states residue server-side; ReconcileRecord stores full key arrays; confirm updateOutput clears spentBy; full push resurrection risk.
11. Action batches: forward PUT /action-batch/* instead of disabling the capability.
12. commissions.satoshis bigint->integer narrowing: check max before window.
13. Minor items (see conversation).
