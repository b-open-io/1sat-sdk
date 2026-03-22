import { useCallback, useState } from "react";
import type { FileReadResult } from "../../../shared/types";
import {
	MetadataEditor,
	type MetadataEntry,
} from "../../components/metadata-editor";
import { rpc } from "../../rpc";

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function InscribeView() {
	const [file, setFile] = useState<FileReadResult | null>(null);
	const [metadata, setMetadata] = useState<MetadataEntry[]>([
		{ key: "app", value: "1sat-wallet" },
	]);
	const [loading, setLoading] = useState(false);
	const [result, setResult] = useState<{
		txid?: string;
		error?: string;
	} | null>(null);

	const handlePickFile = useCallback(async () => {
		setResult(null);
		try {
			const res = await rpc.request.pickFile({ allowedFileTypes: "*" });
			if ("error" in res) {
				setResult({ error: res.error });
				return;
			}
			setFile(res);
		} catch (err) {
			setResult({ error: String(err) });
		}
	}, []);

	const handleInscribe = useCallback(async () => {
		if (!file) return;

		setLoading(true);
		setResult(null);

		const map = Object.fromEntries(
			metadata.filter((e) => e.key).map((e) => [e.key, e.value]),
		);

		try {
			const res = await rpc.request.inscribeFile({
				base64Content: file.base64Content,
				contentType: file.contentType,
				map: Object.keys(map).length > 0 ? map : undefined,
			});
			setResult(res);
			if (res.txid) {
				setFile(null);
			}
		} catch (err) {
			setResult({ error: String(err) });
		} finally {
			setLoading(false);
		}
	}, [file, metadata]);

	const isImage = file?.contentType.startsWith("image/") ?? false;

	return (
		<div className="p-6 space-y-6">
			<div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
				Inscribe
			</div>

			{/* File selection */}
			<div className="border border-border bg-card p-4 space-y-4">
				<button
					type="button"
					onClick={handlePickFile}
					className="w-full py-3 border border-border text-sm font-mono text-muted-foreground hover:text-foreground hover:border-foreground transition-colors"
				>
					{file ? "Change File" : "Select File"}
				</button>

				{/* File preview */}
				{file && (
					<div className="space-y-3">
						{isImage ? (
							<div className="flex justify-center">
								<img
									src={`data:${file.contentType};base64,${file.base64Content}`}
									alt={file.filename}
									className="max-h-48 object-contain border border-border"
								/>
							</div>
						) : (
							<div className="p-3 bg-muted border border-border text-center">
								<div className="text-sm font-mono text-foreground">
									{file.filename}
								</div>
								<div className="text-xs text-muted-foreground mt-1">
									{file.contentType} &middot; {formatBytes(file.sizeBytes)}
								</div>
							</div>
						)}

						{isImage && (
							<div className="text-xs text-muted-foreground text-center">
								{file.filename} &middot; {file.contentType} &middot;{" "}
								{formatBytes(file.sizeBytes)}
							</div>
						)}
					</div>
				)}
			</div>

			{/* Metadata editor */}
			{file && (
				<div className="border border-border bg-card p-4">
					<MetadataEditor entries={metadata} onChange={setMetadata} />
				</div>
			)}

			{/* Result */}
			{result?.txid && (
				<div className="p-3 border border-primary/50 text-primary text-sm font-mono break-all">
					Inscribed! txid: {result.txid}
				</div>
			)}
			{result?.error && (
				<div className="p-3 border border-destructive text-destructive text-sm font-mono break-all">
					{result.error}
				</div>
			)}

			{/* Inscribe button */}
			{file && (
				<button
					type="button"
					disabled={loading}
					onClick={handleInscribe}
					className="w-full py-3 bg-primary text-primary-foreground font-medium text-sm disabled:opacity-30 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
				>
					{loading ? "Inscribing..." : "Inscribe"}
				</button>
			)}
		</div>
	);
}
