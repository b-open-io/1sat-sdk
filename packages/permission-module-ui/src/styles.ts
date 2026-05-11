/**
 * CSS string for the OneSatPermissionPrompt component. Inlined as a style
 * tag so the host wallet doesn't have to wire up CSS imports.
 *
 * Colors and spacing are kept minimal and theme-driven via CSS variables;
 * a designer pass will replace these with the production palette.
 */
export const promptStyles = `
.opp-root {
  --opp-bg: #ffffff;
  --opp-fg: #1a1a1a;
  --opp-muted: #6b7280;
  --opp-card-bg: #f5f5f7;
  --opp-card-border: #e5e7eb;
  --opp-accent: #f59e0b;
  --opp-approve-bg: #f59e0b;
  --opp-approve-fg: #ffffff;
  --opp-reject-bg: #ffffff;
  --opp-reject-fg: #1a1a1a;
  --opp-reject-border: #d1d5db;
  --opp-status-bg: #fde68a;
  --opp-status-fg: #92400e;

  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: var(--opp-bg);
  color: var(--opp-fg);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 480px;
  overflow: hidden;
}

.opp-root.opp-dark {
  --opp-bg: #1a1a1a;
  --opp-fg: #f5f5f7;
  --opp-muted: #9ca3af;
  --opp-card-bg: #262626;
  --opp-card-border: #3a3a3a;
  --opp-reject-bg: #262626;
  --opp-reject-fg: #f5f5f7;
  --opp-reject-border: #3a3a3a;
  --opp-status-bg: rgba(245, 158, 11, 0.2);
  --opp-status-fg: #fbbf24;
}

.opp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--opp-card-border);
}

.opp-header-brand,
.opp-header-app {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
}

.opp-avatar {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--opp-accent);
  color: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  flex-shrink: 0;
}

.opp-avatar.opp-app {
  background: #3b82f6;
}

.opp-avatar-svg {
  width: 24px;
  height: 24px;
  flex-shrink: 0;
}

.opp-avatar-img {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
}

.opp-body {
  padding: 24px 20px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: center;
}

.opp-icon {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--opp-card-bg);
  border: 1px solid var(--opp-card-border);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 4px;
}

.opp-title {
  font-size: 18px;
  font-weight: 700;
  margin: 0;
  text-align: center;
}

.opp-subtitle {
  font-size: 13px;
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
  font-size: 12px;
  font-weight: 600;
  margin-top: 4px;
}

.opp-card {
  background: var(--opp-card-bg);
  border-radius: 8px;
  margin: 0 16px;
  padding: 12px 16px;
  font-size: 13px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.opp-featured {
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--opp-card-bg);
  border-radius: 8px;
  margin: 0 16px;
  padding: 12px;
}

.opp-featured-image {
  width: 64px;
  height: 64px;
  border-radius: 8px;
  object-fit: cover;
  background: rgba(0, 0, 0, 0.1);
  flex-shrink: 0;
}

.opp-featured-meta {
  display: flex;
  flex-direction: column;
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
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 12px;
  word-break: break-all;
  text-align: right;
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
}

.opp-actions {
  display: flex;
  gap: 12px;
  padding: 16px 20px 12px;
}

.opp-button {
  flex: 1;
  padding: 12px 16px;
  border-radius: 8px;
  font-size: 14px;
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
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px 20px 16px;
  font-size: 11px;
  color: var(--opp-muted);
  text-align: center;
}
`
