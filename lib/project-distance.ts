export const MEFFORD_ESTIMATING_ORIGIN = "109 Fieldview Drive, Versailles, KY 40383";

type GeocodedLocation = {
  latitude: number;
  longitude: number;
  resolvedAddress: string;
  provider: string;
};

type CensusResponse = {
  result?: { addressMatches?: Array<{ matchedAddress?: string; coordinates?: { x?: number; y?: number } }> };
};

type PlaceResponse = {
  results?: Array<{ name?: string; admin1?: string; country_code?: string; latitude?: number; longitude?: number }>;
};

type RouteResponse = {
  code?: string;
  routes?: Array<{ distance?: number }>;
};

function normalizedAddress(address: string) {
  const compact = address.replace(/[\r\n]+/g, ", ").replace(/\s+/g, " ").replace(/\s*,\s*/g, ", ").replace(/,+/g, ",").replace(/^,|,$/g, "").trim();
  return /(?:\bUSA\b|\bUnited States\b)$/i.test(compact) ? compact : `${compact}, USA`;
}

function placeCandidate(address: string) {
  const normalized = normalizedAddress(address);
  const zip = normalized.match(/\b\d{5}(?:-\d{4})?\b/)?.[0];
  if (zip) return zip;
  const parts = normalized.split(",").map((part) => part.trim()).filter(Boolean);
  return parts.length >= 3 ? parts.at(-3) || normalized : parts[0] || normalized;
}

async function geocodeAddress(address: string, fetcher: typeof fetch): Promise<GeocodedLocation> {
  const normalized = normalizedAddress(address);
  const withoutUnit = normalized.replace(/,?\s+(?:APT|APARTMENT|UNIT|SUITE|STE|BLDG|BUILDING|FLOOR|FL|#)\s*[A-Z0-9-]+(?=,|$)/i, "");
  for (const candidate of [...new Set([normalized, withoutUnit])]) {
    const url = new URL("https://geocoding.geo.census.gov/geocoder/locations/onelineaddress");
    url.searchParams.set("address", candidate);
    url.searchParams.set("benchmark", "Public_AR_Current");
    url.searchParams.set("format", "json");
    try {
      const response = await fetcher(url, { headers: { "User-Agent": "Mefford-Command-Center/1.0 (meffcon.com)" } });
      if (!response.ok) continue;
      const data = await response.json() as CensusResponse;
      const match = data.result?.addressMatches?.[0];
      const latitude = Number(match?.coordinates?.y);
      const longitude = Number(match?.coordinates?.x);
      if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
        return { latitude, longitude, resolvedAddress: String(match?.matchedAddress || candidate), provider: "U.S. Census + OSRM" };
      }
    } catch {
      // The place fallback below keeps manual-free estimating available when the street geocoder is unavailable.
    }
  }

  const place = placeCandidate(address);
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", place);
  url.searchParams.set("count", "5");
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");
  const response = await fetcher(url, { headers: { "User-Agent": "Mefford-Command-Center/1.0" } });
  if (!response.ok) throw new Error("The project address could not be located.");
  const data = await response.json() as PlaceResponse;
  const match = data.results?.find((item) => Number.isFinite(item.latitude) && Number.isFinite(item.longitude));
  if (!match) throw new Error("The project address could not be located.");
  return {
    latitude: Number(match.latitude),
    longitude: Number(match.longitude),
    resolvedAddress: [match.name, match.admin1, match.country_code].filter(Boolean).join(", "),
    provider: "Open-Meteo Place + OSRM",
  };
}

export function straightLineMiles(from: Pick<GeocodedLocation, "latitude" | "longitude">, to: Pick<GeocodedLocation, "latitude" | "longitude">) {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const latitudeDelta = radians(to.latitude - from.latitude);
  const longitudeDelta = radians(to.longitude - from.longitude);
  const firstLatitude = radians(from.latitude);
  const secondLatitude = radians(to.latitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(firstLatitude) * Math.cos(secondLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 3_958.8 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function oneDecimal(value: number) {
  return Math.round(value * 10) / 10;
}

export async function calculateProjectDistance(address: string, fetcher: typeof fetch = fetch) {
  const destinationAddress = address.trim();
  if (destinationAddress.length < 3 || destinationAddress.length > 300) throw new Error("A valid project address is required.");
  const [origin, destination] = await Promise.all([
    geocodeAddress(MEFFORD_ESTIMATING_ORIGIN, fetcher),
    geocodeAddress(destinationAddress, fetcher),
  ]);

  let oneWayMiles = 0;
  let approximate = false;
  let provider = `${destination.provider.replace(/ \+ OSRM$/, "")} + OSRM Driving Route`;
  try {
    const routeUrl = new URL(`https://router.project-osrm.org/route/v1/driving/${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}`);
    routeUrl.searchParams.set("overview", "false");
    routeUrl.searchParams.set("alternatives", "false");
    routeUrl.searchParams.set("steps", "false");
    const response = await fetcher(routeUrl, { headers: { "User-Agent": "Mefford-Command-Center/1.0 (meffcon.com)" } });
    const data = response.ok ? await response.json() as RouteResponse : {};
    const meters = Number(data.routes?.[0]?.distance);
    if (!response.ok || data.code !== "Ok" || !Number.isFinite(meters) || meters <= 0) throw new Error("No driving route was returned.");
    oneWayMiles = meters / 1_609.344;
  } catch {
    oneWayMiles = straightLineMiles(origin, destination) * 1.2;
    approximate = true;
    provider = `${destination.provider.replace(/ \+ OSRM$/, "")} · Coordinate Road Estimate`;
  }

  return {
    originAddress: MEFFORD_ESTIMATING_ORIGIN,
    resolvedAddress: destination.resolvedAddress,
    oneWayMiles: oneDecimal(oneWayMiles),
    roundTripMiles: oneDecimal(oneWayMiles * 2),
    provider,
    approximate,
  };
}
