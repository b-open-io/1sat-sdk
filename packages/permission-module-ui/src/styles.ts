/**
 * CSS string for the OneSatPermissionPrompt component. Inlined as a style
 * tag so the host wallet doesn't have to wire up CSS imports.
 *
 * Colors match `docs/plans/mockups/p1sat-permissions.pen`.
 */
export const promptStyles = `
.opp-root {
  --opp-bg: #ffffff;
  --opp-fg: #111827;
  --opp-muted: #6b7280;
  --opp-card-bg: #f7f8fa;
  --opp-card-border: #eceef2;
  --opp-accent: #E5A920;
  --opp-approve-bg: #E5A920;
  --opp-approve-fg: #ffffff;
  --opp-reject-bg: #ffffff;
  --opp-reject-fg: #111827;
  --opp-reject-border: #d1d5db;
  --opp-status-bg: #FFFBE6;
  --opp-status-fg: #E5A920;
  --opp-trust-ok-bg: #ECFDF5;
  --opp-trust-ok-fg: #059669;
  --opp-trust-warn-bg: #FFFBEB;
  --opp-trust-warn-fg: #D97706;
  --opp-trust-bad-bg: #FEF2F2;
  --opp-trust-bad-fg: #DC2626;

  font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: var(--opp-bg);
  color: var(--opp-fg);
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 480px;
  min-height: 100%;
  overflow-x: hidden;
  overflow-y: auto;
}

.opp-bottom {
  margin-top: auto;
  display: flex;
  flex-direction: column;
}

.opp-root.opp-dark {
  --opp-bg: #0F1117;
  --opp-fg: #F9FAFB;
  --opp-muted: #9ca3af;
  --opp-card-bg: #1A1D27;
  --opp-card-border: #232636;
  --opp-reject-bg: #0F1117;
  --opp-reject-fg: #F9FAFB;
  --opp-reject-border: #2D3142;
  --opp-status-bg: #2A2408;
  --opp-status-fg: #E5A920;
  --opp-trust-ok-bg: #0A2E1F;
  --opp-trust-ok-fg: #34D399;
  --opp-trust-warn-bg: #2A2008;
  --opp-trust-warn-fg: #FBBF24;
  --opp-trust-bad-bg: #2A1215;
  --opp-trust-bad-fg: #F87171;
}

.opp-body {
  padding: 24px 20px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: center;
}

.opp-coin {
  width: 48px;
  height: 48px;
  flex-shrink: 0;
}

.opp-title {
  font-size: 16px;
  font-weight: 700;
  margin: 0;
  text-align: center;
}

.opp-subtitle {
  font-size: 12px;
  color: var(--opp-muted);
  margin: 0;
  text-align: center;
  line-height: 1.4;
}

.opp-status {
  background: var(--opp-status-bg);
  color: var(--opp-status-fg);
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  margin-top: 4px;
  border: 1px solid var(--opp-card-border);
}

.opp-card {
  background: var(--opp-card-bg);
  border: 1px solid var(--opp-card-border);
  border-radius: 10px;
  margin: 0 20px;
  padding: 16px;
  font-size: 13px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.opp-featured {
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--opp-card-bg);
  border: 1px solid var(--opp-card-border);
  border-radius: 10px;
  margin: 0 20px 8px;
  padding: 16px;
}

/* Subtle danger chrome for burn / destructive token ops */
.opp-featured-danger {
  border-color: rgba(220, 38, 38, 0.45);
  background: color-mix(in srgb, var(--opp-card-bg) 88%, #7f1d1d 12%);
}

.opp-featured-danger .opp-featured-title {
  color: #f87171;
}

.opp-featured-danger .opp-featured-image,
.opp-featured-danger .opp-featured-placeholder {
  border: 1px solid rgba(220, 38, 38, 0.35);
  background: rgba(127, 29, 29, 0.25);
  color: #fca5a5;
}

.opp-dark .opp-featured-danger {
  border-color: rgba(248, 113, 113, 0.4);
  background: color-mix(in srgb, var(--opp-card-bg) 85%, #450a0a 15%);
}

.opp-preview-pair {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.opp-preview-arrow {
  color: var(--opp-muted);
  font-size: 14px;
  line-height: 1;
}

.opp-preview-pair .opp-featured-image {
  width: 64px;
  height: 64px;
}

.opp-featured-image {
  width: 80px;
  height: 80px;
  border-radius: 8px;
  object-fit: cover;
  background: rgba(0, 0, 0, 0.08);
  flex-shrink: 0;
}

.opp-featured-image-token {
  width: 48px;
  height: 48px;
  border-radius: 999px;
}

.opp-featured-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--opp-muted);
  font-size: 18px;
}

.opp-preview-opns {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 6px;
  box-sizing: border-box;
  overflow: hidden;
}

.opp-preview-opns-avatar {
  width: 36px;
  height: 36px;
  border-radius: 999px;
  object-fit: cover;
  background: rgba(0, 0, 0, 0.08);
  flex-shrink: 0;
}

.opp-preview-opns-name {
  font-size: 11px;
  font-weight: 600;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: center;
  color: var(--opp-fg, inherit);
}

.opp-preview-text {
  margin: 0;
  padding: 6px;
  box-sizing: border-box;
  overflow: hidden;
  font-size: 9px;
  line-height: 1.25;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: 'Roboto Mono', ui-monospace, SFMono-Regular, monospace;
  color: var(--opp-muted);
}

.opp-preview-json {
  white-space: pre;
  overflow: auto;
}

.opp-preview-frame {
  border: 0;
  padding: 0;
  overflow: hidden;
  background: #fff;
  pointer-events: none;
}

.opp-preview-value {
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  background: rgba(229, 169, 32, 0.12);
  border: 1px solid rgba(229, 169, 32, 0.35);
  color: var(--opp-fg, inherit);
}

.opp-preview-value-icon {
  width: 32px;
  height: 32px;
  color: #E5A920;
}

/* Amount subtitles must never ellipsis — full sat counts are the point. */
.opp-featured-subtitle-text.opp-amount {
  font-family: 'Roboto Mono', ui-monospace, SFMono-Regular, monospace;
  font-variant-numeric: tabular-nums;
  white-space: normal;
  overflow: visible;
  text-overflow: unset;
  word-break: keep-all;
}

.opp-featured-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  flex: 1;
}

.opp-featured-title {
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.opp-featured-subtitle {
  font-size: 12px;
  color: var(--opp-muted);
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.opp-featured-subtitle-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  font-family: 'Roboto Mono', ui-monospace, SFMono-Regular, monospace;
}

.opp-featured-meta-line {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 12px;
  color: var(--opp-muted);
}

.opp-featured-meta-line-bare {
  align-items: center;
}

.opp-featured-meta-key {
  flex-shrink: 0;
  opacity: 0.75;
  min-width: 2.5em;
}

.opp-featured-meta-value {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  flex: 1;
}

.opp-featured-meta-value-mono {
  font-family: 'Roboto Mono', ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
}

.opp-trust-wrap {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0 20px 8px;
}

.opp-trust {
  display: inline-flex;
  align-self: flex-start;
  padding: 3px 8px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
}

.opp-trust-verified {
  background: var(--opp-trust-ok-bg);
  color: var(--opp-trust-ok-fg);
}

.opp-trust-unverified {
  background: var(--opp-trust-warn-bg);
  color: var(--opp-trust-warn-fg);
}

.opp-trust-mismatch {
  background: var(--opp-trust-bad-bg);
  color: var(--opp-trust-bad-fg);
}

.opp-trust-note {
  padding: 10px;
  border-radius: 8px;
  font-size: 11px;
  line-height: 1.35;
}

.opp-trust-note-verified {
  background: var(--opp-trust-ok-bg);
  color: var(--opp-trust-ok-fg);
}

.opp-trust-note-unverified {
  background: var(--opp-trust-warn-bg);
  color: var(--opp-trust-warn-fg);
}

.opp-trust-note-mismatch {
  background: var(--opp-trust-bad-bg);
  color: var(--opp-trust-bad-fg);
}

.opp-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.opp-row-key {
  color: var(--opp-muted);
  flex-shrink: 0;
}

.opp-row-value-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  max-width: 70%;
  justify-content: flex-end;
}

.opp-row-value {
  font-family: 'Roboto Mono', ui-monospace, SFMono-Regular, monospace;
  font-size: 12px;
  font-weight: 500;
  text-align: right;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.opp-copy {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  border: 1px solid var(--opp-reject-border);
  background: var(--opp-bg);
  color: var(--opp-fg);
  cursor: pointer;
}

.opp-copy:hover {
  border-color: var(--opp-accent);
  color: var(--opp-accent);
}

.opp-fee-note {
  font-size: 11px;
  color: var(--opp-muted);
  line-height: 1.3;
  margin-top: -4px;
}

.opp-actions {
  display: flex;
  gap: 12px;
  padding: 20px 20px 12px;
}

.opp-button {
  flex: 1;
  padding: 0 16px;
  height: 48px;
  border-radius: 10px;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
  transition: opacity 120ms ease;
}

.opp-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.opp-button-reject {
  background: var(--opp-reject-bg);
  color: var(--opp-reject-fg);
  border-color: var(--opp-reject-border);
}

.opp-button-approve {
  background: var(--opp-approve-bg);
  color: var(--opp-approve-fg);
}

.opp-footer {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 20px 16px;
  font-size: 11px;
  font-weight: 500;
  color: var(--opp-muted);
}
`
