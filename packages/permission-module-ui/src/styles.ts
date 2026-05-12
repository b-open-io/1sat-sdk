/**
 * CSS string for the OneSatPermissionPrompt component. Inlined as a style
 * tag so the host wallet doesn't have to wire up CSS imports.
 *
 * Colors match the design in `1sat-permissions-popups.pen`.
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
  margin: 0 20px;
  padding: 16px;
}

.opp-featured-image {
  width: 80px;
  height: 80px;
  border-radius: 8px;
  object-fit: cover;
  background: rgba(0, 0, 0, 0.1);
  flex-shrink: 0;
}

.opp-featured-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
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
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.opp-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.opp-row-key {
  color: var(--opp-muted);
}

.opp-row-value {
  font-family: 'Roboto Mono', ui-monospace, SFMono-Regular, monospace;
  font-size: 13px;
  font-weight: 500;
  text-align: right;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  max-width: 60%;
}

.opp-meta {
  display: flex;
  justify-content: space-between;
  padding: 12px 20px;
  font-size: 12px;
  color: var(--opp-muted);
}

.opp-meta-value {
  color: var(--opp-fg);
  font-weight: 500;
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
