import QRCode from "qrcode";
import { useEffect, useRef } from "react";

interface QrCodeProps {
	value: string;
	size?: number;
}

export function QrCode({ value, size = 200 }: QrCodeProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas || !value) return;

		QRCode.toCanvas(canvas, value, {
			width: size,
			margin: 2,
			color: {
				dark: "#ffffff",
				light: "#000000",
			},
			errorCorrectionLevel: "M",
		}).catch((err: Error) => {
			console.error("QR code generation failed:", err);
		});
	}, [value, size]);

	return (
		<div className="inline-flex border border-border bg-black p-2">
			<canvas ref={canvasRef} />
		</div>
	);
}
