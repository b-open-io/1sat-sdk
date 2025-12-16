/**
 * @1sat/utils - Utility functions for 1Sat Ordinals SDK
 *
 * For byte manipulation, use @bsv/sdk Utils directly:
 * import { Utils } from '@bsv/sdk'
 * const { toArray, toBase64, toHex, toUTF8 } = Utils
 */

import type {
	CollectionItemSubTypeData,
	CollectionSubTypeData,
	IconInscription,
	ImageContentType,
	MAP,
	PreMAP,
} from '@1sat/types'
import { Utils } from '@bsv/sdk'
import { imageMeta } from 'image-meta'

const { toArray, toUTF8 } = Utils

// ============================================================================
// Outpoint Utilities
// ============================================================================

/**
 * Parse an outpoint string (txid_vout) into its components
 */
export function parseOutpoint(outpoint: string): {
	txid: string
	vout: number
} {
	const parts = outpoint.split('_')
	if (parts.length !== 2) {
		throw new Error(`Invalid outpoint format: ${outpoint}`)
	}
	const [txid, voutStr] = parts
	const vout = Number.parseInt(voutStr, 10)
	if (Number.isNaN(vout)) {
		throw new Error(`Invalid vout in outpoint: ${outpoint}`)
	}
	return { txid, vout }
}

/**
 * Format txid and vout into an outpoint string
 */
export function formatOutpoint(txid: string, vout: number): string {
	return `${txid}_${vout}`
}

/**
 * Validate that a string is a valid outpoint format
 */
export function isValidOutpoint(outpoint: string): boolean {
	if (!outpoint.includes('_') || outpoint.endsWith('_')) {
		return false
	}

	const parts = outpoint.split('_')
	if (parts.length !== 2) {
		return false
	}

	const [txid, voutStr] = parts
	const vout = Number.parseInt(voutStr, 10)

	if (Number.isNaN(vout) || vout < 0) {
		return false
	}

	// txid should be 64 hex characters (unless it starts with _)
	if (!outpoint.startsWith('_') && txid.length !== 64) {
		return false
	}

	return true
}

// ============================================================================
// Metadata Utilities
// ============================================================================

/**
 * Convert PreMAP metadata to MAP by stringifying non-string values
 * Arrays and objects are JSON.stringify'd, other values are String()'d
 */
export function stringifyMetaData(metaData?: PreMAP): MAP | undefined {
	if (!metaData) return undefined

	const result: MAP = {
		app: metaData.app,
		type: metaData.type,
	}

	for (const [key, value] of Object.entries(metaData)) {
		if (value !== undefined) {
			if (typeof value === 'string') {
				result[key] = value
			} else if (Array.isArray(value) || typeof value === 'object') {
				result[key] = JSON.stringify(value)
			} else {
				result[key] = String(value)
			}
		}
	}

	return result
}

// ============================================================================
// Icon Validation
// ============================================================================

export const ErrorOversizedIcon = new Error(
	'Image must be a square image with dimensions <= 400x400',
)
export const ErrorIconProportions = new Error('Image must be a square image')
export const ErrorInvalidIconData = new Error('Error processing image')
export const ErrorImageDimensionsUndefined = new Error(
	'Image dimensions are undefined',
)

const IMAGE_CONTENT_TYPES: readonly ImageContentType[] = [
	'image/png',
	'image/jpeg',
	'image/gif',
	'image/svg+xml',
	'image/webp',
]

function isImageContentType(value: string): value is ImageContentType {
	return IMAGE_CONTENT_TYPES.includes(value as ImageContentType)
}

/**
 * Validate an SVG icon (base64 encoded)
 */
function validateSvg(svgBase64: string): Error | null {
	const svgString = toUTF8(toArray(svgBase64, 'base64'))
	const widthMatch = svgString.match(/<svg[^>]*\s+width="([^"]+)"/)
	const heightMatch = svgString.match(/<svg[^>]*\s+height="([^"]+)"/)

	if (!widthMatch || !heightMatch) {
		return ErrorImageDimensionsUndefined
	}

	const width = Number.parseInt(widthMatch[1], 10)
	const height = Number.parseInt(heightMatch[1], 10)

	if (Number.isNaN(width) || Number.isNaN(height)) {
		return ErrorImageDimensionsUndefined
	}

	if (width !== height) {
		return ErrorIconProportions
	}
	if (width > 400 || height > 400) {
		return ErrorOversizedIcon
	}

	return null
}

/**
 * Validate icon inscription data
 * Returns null if valid, Error if invalid
 */
export async function validIconData(
	icon: IconInscription,
): Promise<Error | null> {
	const { dataB64, contentType } = icon

	if (contentType === 'image/svg+xml') {
		return validateSvg(dataB64)
	}

	if (!isImageContentType(contentType)) {
		return ErrorInvalidIconData
	}

	try {
		const buffer = Uint8Array.from(toArray(dataB64, 'base64'))
		const dimensions = imageMeta(buffer)

		if (dimensions.width === undefined || dimensions.height === undefined) {
			return ErrorImageDimensionsUndefined
		}
		if (dimensions.width !== dimensions.height) {
			return ErrorIconProportions
		}
		if (dimensions.width > 400 || dimensions.height > 400) {
			return ErrorOversizedIcon
		}

		return null
	} catch {
		return ErrorInvalidIconData
	}
}

/**
 * Validate icon outpoint format (txid_vout)
 */
export function validIconFormat(icon: string): boolean {
	return isValidOutpoint(icon)
}

// ============================================================================
// SubType Data Validation
// ============================================================================

/**
 * Validate collection or collection item subtype data
 * Returns Error if validation fails, undefined if valid
 */
export function validateSubTypeData(
	subType: 'collection' | 'collectionItem',
	subTypeData: CollectionItemSubTypeData | CollectionSubTypeData,
): Error | undefined {
	try {
		if (subType === 'collection') {
			const collectionData = subTypeData as CollectionSubTypeData
			if (!collectionData.description) {
				return new Error('Collection description is required')
			}
			if (!collectionData.quantity) {
				return new Error('Collection quantity is required')
			}
			if (collectionData.rarityLabels) {
				if (!Array.isArray(collectionData.rarityLabels)) {
					return new Error('Rarity labels must be an array')
				}
				if (
					!collectionData.rarityLabels.every((label) => {
						return Object.values(label).every(
							(value) => typeof value === 'string',
						)
					})
				) {
					return new Error(
						`Invalid rarity labels ${collectionData.rarityLabels}`,
					)
				}
			}
			if (collectionData.traits) {
				if (typeof collectionData.traits !== 'object') {
					return new Error('Collection traits must be an object')
				}
				if (
					!Object.keys(collectionData.traits).every(
						(key) =>
							typeof key === 'string' &&
							typeof collectionData.traits[key] === 'object',
					)
				) {
					return new Error(
						'Collection traits must be a valid CollectionTraits object',
					)
				}
			}
		}

		if (subType === 'collectionItem') {
			const itemData = subTypeData as CollectionItemSubTypeData
			if (!itemData.collectionId) {
				return new Error('Collection id is required')
			}
			if (!itemData.collectionId.includes('_')) {
				return new Error('Collection id must be a valid outpoint')
			}
			if (itemData.collectionId.split('_')[0].length !== 64) {
				return new Error('Collection id must contain a valid txid')
			}
			if (Number.isNaN(Number.parseInt(itemData.collectionId.split('_')[1]))) {
				return new Error('Collection id must contain a valid vout')
			}

			if (itemData.mintNumber && typeof itemData.mintNumber !== 'number') {
				return new Error('Mint number must be a number')
			}
			if (itemData.rank && typeof itemData.rank !== 'number') {
				return new Error('Rank must be a number')
			}
			if (itemData.rarityLabel && typeof itemData.rarityLabel !== 'string') {
				return new Error('Rarity label must be a string')
			}
			if (itemData.traits && typeof itemData.traits !== 'object') {
				return new Error('Traits must be an object')
			}
			if (itemData.attachments && !Array.isArray(itemData.attachments)) {
				return new Error('Attachments must be an array')
			}
		}

		return undefined
	} catch {
		return new Error('Invalid JSON data')
	}
}

// ============================================================================
// Key Derivation Utilities
// ============================================================================

export {
	// Types
	type WalletKeys,
	type KeyDerivationPaths,
	// Derivation path constants
	YOURS_WALLET_PATH,
	YOURS_ID_PATH,
	YOURS_ORD_PATH,
	RELAYX_ORD_PATH,
	RELAYX_ID_PATH,
	RELAYX_WALLET_PATH,
	RELAYX_SWEEP_PATH,
	TWETCH_WALLET_PATH,
	TWETCH_ORD_PATH,
	AYM_WALLET_PATH,
	AYM_ORD_PATH,
	// Conversion utilities
	wifToHex,
	wifToAddress,
	wifToPublicKey,
	// Key derivation functions
	deriveKeyFromMnemonic,
	getKeysFromMnemonicAndPaths,
	findKeysWithVanityOrdinal,
	generateMnemonic,
	isValidMnemonic,
} from './keys'
