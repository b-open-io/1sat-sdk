import { OneSatServices } from "@1sat/client";

let _services: OneSatServices | null = null;
let _baseUrl: string | undefined;

export function configureServices(baseUrl: string): void {
	_baseUrl = baseUrl;
	_services = null;
}

export function getServices(): OneSatServices {
	if (!_services) {
		const url = _baseUrl ?? (typeof window !== "undefined" ? window.location.origin : "");
		if (!url) throw new Error("No base URL configured. Call configureServices() first.");
		_services = new OneSatServices("main", url);
	}
	return _services;
}
