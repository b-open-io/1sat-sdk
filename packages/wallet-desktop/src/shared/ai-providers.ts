// Shared AI provider definitions used by both settings and onboarding.

export type AiProvider =
	| 'ollama'
	| 'lmstudio'
	| 'openrouter'
	| 'openai'
	| 'anthropic'

export const AI_SETTINGS_KEY = '1sat-ai-settings'

export interface AiProviderInfo {
	baseUrl: string
	label: string
	/** Whether this provider runs locally (auto-detectable without API key) */
	local: boolean
}

export const PROVIDER_DEFAULTS: Record<AiProvider, AiProviderInfo> = {
	ollama: {
		baseUrl: 'http://localhost:11434/v1',
		label: 'Ollama',
		local: true,
	},
	lmstudio: {
		baseUrl: 'http://localhost:1234/v1',
		label: 'LM Studio',
		local: true,
	},
	openrouter: {
		baseUrl: 'https://openrouter.ai/api/v1',
		label: 'OpenRouter',
		local: false,
	},
	openai: {
		baseUrl: 'https://api.openai.com/v1',
		label: 'OpenAI',
		local: false,
	},
	anthropic: {
		baseUrl: 'https://api.anthropic.com/v1',
		label: 'Anthropic',
		local: false,
	},
}

/** Providers that can be auto-detected without an API key */
export const LOCAL_PROVIDERS: AiProvider[] = ['ollama', 'lmstudio']
