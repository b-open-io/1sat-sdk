import {
	AIP,
	AIP_PREFIX,
	Inscription,
	MAP,
	MAP_PREFIX,
	PrivateKeySigner,
} from '@1sat/templates'
import { P2PKH, type PrivateKey, Script, Utils } from '@bsv/sdk'
import { buildOrdfsDirManifest } from '../ordfs/manifest'
import { MANIFEST_CONTENT_TYPE } from './constants'
import type {
	PackageFile,
	PackageMapMetadata,
	PackageTxOutput,
	PackageTxResult,
} from './types'

/**
 * Known fields on PackageMapMetadata that are handled explicitly
 * when building MAP metadata. Any other string keys on the metadata
 * object are treated as extra MAP fields (e.g. font.family).
 */
const KNOWN_METADATA_FIELDS = new Set([
	'app',
	'type',
	'name',
	'version',
	'description',
	'language',
	'homepage',
	'prev',
	'opns.name',
	'opns.outpoint',
	'title',
	'author',
	'dependencies',
	'devDependencies',
	'registryDependencies',
	'categories',
])

/**
 * Build ordinal inscription outputs for a package publish transaction.
 *
 * Each file becomes a 1-sat inscription output. The manifest (ord-fs/json)
 * is the LAST output and carries the MAP metadata + AIP signature as a
 * script suffix after the inscription envelope.
 *
 * Output layout:
 *   [0..N-1]  file inscriptions  (1 sat each)
 *   [N]       manifest inscription with MAP + AIP suffix  (1 sat, tracked ordinal)
 */
export async function buildPackageOutputs(
	files: PackageFile[],
	metadata: PackageMapMetadata,
	privateKey: PrivateKey,
): Promise<PackageTxResult> {
	const outputs: PackageTxOutput[] = []

	// P2PKH locking script derived from the signing key -- used as the
	// scriptPrefix on every inscription so the outputs are spendable.
	const p2pkhPrefix = new P2PKH().lock(privateKey.toAddress())

	// -------------------------------------------------------------------
	// 1. File inscription outputs
	// -------------------------------------------------------------------
	for (const file of files) {
		const inscription = Inscription.create(file.content, file.contentType, {
			scriptPrefix: p2pkhPrefix,
		})
		const lockingScript = inscription.lock()

		outputs.push({
			lockingScriptHex: Utils.toHex(lockingScript.toBinary()),
			satoshis: 1,
			description: `file: ${file.path}`,
			isManifest: false,
		})
	}

	// -------------------------------------------------------------------
	// 2. Build the ord-fs directory tree
	//    Root-level files get `_N` references. Files in subdirectories
	//    get their own ord-fs/json manifest inscriptions so ORDFS can
	//    traverse nested directories and unchanged branches can be
	//    re-referenced in version updates. The `_N` relative-vout layout
	//    is computed by the shared, key-agnostic tree builder; here we
	//    only attach the P2PKH prefix and emit the manifest inscriptions.
	// -------------------------------------------------------------------
	const tree = buildOrdfsDirManifest(files)

	// Create subdirectory manifest inscriptions (one per subdirectory).
	// The tree builder assigned these vouts immediately after the file
	// inscriptions, so they line up with `outputs.length` here.
	for (const subdir of tree.subdirs) {
		const subdirBytes = new Uint8Array(
			Utils.toArray(JSON.stringify(subdir.manifest), 'utf8'),
		)
		const subdirInscription = Inscription.create(
			subdirBytes,
			MANIFEST_CONTENT_TYPE,
			{ scriptPrefix: p2pkhPrefix },
		)
		outputs.push({
			lockingScriptHex: Utils.toHex(subdirInscription.lock().toBinary()),
			satoshis: 1,
			description: `dir: ${subdir.name}/`,
			isManifest: false,
		})
	}

	// Serialize the root manifest -- references root files and subdirectories.
	const manifestBytes = new Uint8Array(
		Utils.toArray(JSON.stringify(tree.root), 'utf8'),
	)

	// -------------------------------------------------------------------
	// 3. MAP metadata -- build protocol chunks for the suffix
	// -------------------------------------------------------------------
	const mapFields: Record<string, string> = {
		app: metadata.app,
		type: metadata.type,
		name: metadata.name,
		version: metadata.version,
		description: metadata.description,
	}
	if (metadata.language) mapFields.language = metadata.language
	if (metadata.homepage) mapFields.homepage = metadata.homepage
	if (metadata.prev) mapFields.prev = metadata.prev
	if (metadata['opns.name']) mapFields['opns.name'] = metadata['opns.name']
	if (metadata['opns.outpoint'])
		mapFields['opns.outpoint'] = metadata['opns.outpoint']
	if (metadata.title) mapFields.title = metadata.title
	if (metadata.author) mapFields.author = metadata.author
	if (metadata.dependencies) mapFields.dependencies = metadata.dependencies
	if (metadata.devDependencies)
		mapFields.devDependencies = metadata.devDependencies
	if (metadata.registryDependencies)
		mapFields.registryDependencies = metadata.registryDependencies
	if (metadata.categories) mapFields.categories = metadata.categories

	// Include any extra MAP fields from the index signature (e.g. font.family)
	for (const key of Object.keys(metadata)) {
		if (!KNOWN_METADATA_FIELDS.has(key) && metadata[key] != null) {
			mapFields[key] = metadata[key] as string
		}
	}

	const mapScript = MAP.set(mapFields)
	// MAP.set() returns an OP_RETURN | MAP_PREFIX | data locking script.
	// We need just the data chunks (skip OP_RETURN and MAP_PREFIX pushdata).
	const mapDataChunks = mapScript.chunks.slice(2)
	const mapDataScript = new Script(mapDataChunks)

	const mapProtocol = {
		protocol: MAP_PREFIX,
		script: mapDataScript.toBinary(),
		pos: 0,
	}

	// -------------------------------------------------------------------
	// 4. AIP signature -- signs MAP protocol data so authorship is verifiable
	// -------------------------------------------------------------------
	const signatureData: number[] = []
	signatureData.push(...Utils.toArray(mapProtocol.protocol, 'utf8'))
	signatureData.push(...mapProtocol.script)
	signatureData.push(0x7c) // pipe separator

	const aipData = await AIP.sign(
		signatureData,
		new PrivateKeySigner(privateKey),
	)
	const aipScript = aipData.lock()
	// AIP.lock() wraps in BitCom (OP_RETURN | AIP_PREFIX | data).
	// Extract only the data chunks after OP_RETURN and AIP_PREFIX.
	const aipDataChunks = aipScript.chunks.slice(2)
	const aipDataScript = new Script(aipDataChunks)

	const aipProtocol = {
		protocol: AIP_PREFIX,
		script: aipDataScript.toBinary(),
		pos: 1,
	}

	// -------------------------------------------------------------------
	// 5. Compose the suffix script: OP_RETURN MAP_PREFIX <map-data> | AIP_PREFIX <aip-data>
	//    This goes AFTER the inscription envelope's OP_ENDIF.
	// -------------------------------------------------------------------
	const suffix = buildBitComSuffix([mapProtocol, aipProtocol])

	// -------------------------------------------------------------------
	// 6. Create the manifest inscription with the MAP+AIP suffix
	// -------------------------------------------------------------------
	const manifestInscription = Inscription.create(
		manifestBytes,
		MANIFEST_CONTENT_TYPE,
		{
			scriptPrefix: p2pkhPrefix,
			scriptSuffix: suffix,
		},
	)
	const manifestLockingScript = manifestInscription.lock()
	const manifestVout = outputs.length

	outputs.push({
		lockingScriptHex: Utils.toHex(manifestLockingScript.toBinary()),
		satoshis: 1,
		description: 'manifest (ord-fs/json)',
		isManifest: true,
	})

	return {
		outputs,
		manifestVout,
	}
}

/**
 * Build an OP_RETURN + piped-protocol suffix script from protocol descriptors.
 *
 * Produces: OP_RETURN <proto1_prefix> <proto1_data> "|" <proto2_prefix> <proto2_data> ...
 *
 * This is the same format BitCom.lock() produces, but as a raw Script
 * suitable for use as an Inscription scriptSuffix.
 */
function buildBitComSuffix(
	protocols: { protocol: string; script: number[]; pos: number }[],
): Script {
	const script = new Script()

	// OP_RETURN marks the start of the data section
	script.writeOpCode(0x6a) // OP_RETURN

	for (let i = 0; i < protocols.length; i++) {
		const proto = protocols[i]

		// Protocol identifier as pushdata
		script.writeBin(Utils.toArray(proto.protocol, 'utf8'))

		// Protocol data -- re-parse into chunks and append individually
		// so that pushdata opcodes are preserved correctly.
		if (proto.script.length > 0) {
			const protoScript = Script.fromBinary(proto.script)
			for (const chunk of protoScript.chunks) {
				if (chunk.data != null) {
					script.writeBin(chunk.data)
				} else {
					script.writeOpCode(chunk.op)
				}
			}
		}

		// Pipe delimiter between protocols (not after the last one)
		if (i < protocols.length - 1) {
			script.writeBin(Utils.toArray('|', 'utf8'))
		}
	}

	return script
}

/**
 * Detect MIME content type from a file path extension.
 */
export function detectContentType(filePath: string): string {
	const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
	const mimeTypes: Record<string, string> = {
		md: 'text/markdown',
		txt: 'text/plain',
		json: 'application/json',
		js: 'application/javascript',
		ts: 'application/typescript',
		tsx: 'application/typescript',
		jsx: 'application/javascript',
		css: 'text/css',
		html: 'text/html',
		xml: 'text/xml',
		yaml: 'text/yaml',
		yml: 'text/yaml',
		svg: 'image/svg+xml',
		png: 'image/png',
		jpg: 'image/jpeg',
		jpeg: 'image/jpeg',
		gif: 'image/gif',
		webp: 'image/webp',
		woff2: 'font/woff2',
		woff: 'font/woff',
		ttf: 'font/ttf',
	}
	return mimeTypes[ext] ?? 'application/octet-stream'
}
