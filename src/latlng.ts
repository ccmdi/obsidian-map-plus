export namespace LatLng {
	// Unverified input - accepts various formats
	export type Like =
		| { lat: number; lng: number }
		| { latitude: number; longitude: number }
		| [number, number] // [lat, lng]
		| string; // "lat,lng" format

	// Verified type using a brand
	export type Verified = {
		readonly lat: number;
		readonly lng: number;
		readonly __brand: 'LatLng';
	};

	// Validation function that narrows the type
	export function parse(input: Like): Verified | null {
		let lat: number;
		let lng: number;

		if (typeof input === 'string') {
			const parts = input.split(',').map(s => parseFloat(s.trim()));
			if (parts.length !== 2) return null;
			[lat, lng] = parts;
		} else if (Array.isArray(input)) {
			[lat, lng] = input;
		} else if ('lat' in input && 'lng' in input) {
			lat = input.lat;
			lng = input.lng;
		} else if ('latitude' in input && 'longitude' in input) {
			lat = input.latitude;
			lng = input.longitude;
		} else {
			return null;
		}

		// Validation
		if (
			typeof lat !== 'number' ||
			typeof lng !== 'number' ||
			!isFinite(lat) ||
			!isFinite(lng) ||
			lat < -90 ||
			lat > 90 ||
			lng < -180 ||
			lng > 180
		) {
			return null;
		}

		// Return branded type
		return { lat, lng, __brand: 'LatLng' } as Verified;
	}

	// Parse or return default value
	export function parseOrDefault(input: Like, defaultValue: Verified): Verified {
		return parse(input) ?? defaultValue;
	}

	// Parse or return [0, 0]
	export function parseOrZero(input: Like): Verified {
		return parse(input) ?? ({ lat: 0, lng: 0, __brand: 'LatLng' } as Verified);
	}

	// Helper to check if already verified
	export function isVerified(input: Like | Verified): input is Verified {
		return typeof input === 'object' && !Array.isArray(input) && '__brand' in input;
	}

	// Convert to array [lat, lng]
	export function toArray(point: Verified): [number, number] {
		return [point.lat, point.lng];
	}

	// Convert to array [lng, lat] (for deck.gl)
	export function toArrayLngLat(point: Verified): [number, number] {
		return [point.lng, point.lat];
	}

	// Convert to object {lat, lng}
	export function toObject(point: Verified): { lat: number; lng: number } {
		return { lat: point.lat, lng: point.lng };
	}

	// Convert to string "lat, lng"
	export function toString(point: Verified, precision = 6): string {
		return `${point.lat.toFixed(precision)}, ${point.lng.toFixed(precision)}`;
	}

	// Distance calculation (simple Euclidean for now)
	export function distance(point1: Verified, point2: Verified): number {
		return Math.sqrt(Math.pow(point1.lat - point2.lat, 2) + Math.pow(point1.lng - point2.lng, 2));
	}

	// Haversine distance in kilometers
	export function distanceHaversine(point1: Verified, point2: Verified): number {
		const R = 6371; // Earth's radius in km
		const dLat = toRadians(point2.lat - point1.lat);
		const dLng = toRadians(point2.lng - point1.lng);
		const a =
			Math.sin(dLat / 2) * Math.sin(dLat / 2) +
			Math.cos(toRadians(point1.lat)) * Math.cos(toRadians(point2.lat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
		const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
		return R * c;
	}

	// Helper for radians conversion
	function toRadians(degrees: number): number {
		return degrees * (Math.PI / 180);
	}

	// Check if two points are equal
	export function equals(point1: Verified, point2: Verified): boolean {
		return point1.lat === point2.lat && point1.lng === point2.lng;
	}

	// Check if coordinates are valid (without parsing)
	export function isValid(lat: number, lng: number): boolean {
		return (
			typeof lat === 'number' &&
			typeof lng === 'number' &&
			isFinite(lat) &&
			isFinite(lng) &&
			lat >= -90 &&
			lat <= 90 &&
			lng >= -180 &&
			lng <= 180
		);
	}

	// Create from lat/lng numbers (with validation)
	export function from(lat: number, lng: number): Verified | null {
		if (!isValid(lat, lng)) return null;
		return { lat, lng, __brand: 'LatLng' } as Verified;
	}

	// Create from lat/lng numbers (unsafe, no validation)
	export function fromUnsafe(lat: number, lng: number): Verified {
		return { lat, lng, __brand: 'LatLng' } as Verified;
	}
}
