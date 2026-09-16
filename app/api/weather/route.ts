import { enforceOnboardingAccess } from "../../../lib/onboarding";
import { recordFirstPartyFailure } from "../../../lib/runtime-observability";
import { resolveCommandActor } from "../../../lib/server-actor";

const WEATHER_LABELS: Array<[number[], string]> = [
  [[0], "Clear"],
  [[1], "Mostly Clear"],
  [[2], "Partly Cloudy"],
  [[3], "Overcast"],
  [[45, 48], "Fog"],
  [[51, 53, 55, 56, 57], "Drizzle"],
  [[61, 63, 65, 66, 67], "Rain"],
  [[71, 73, 75, 77], "Snow"],
  [[80, 81, 82], "Rain Showers"],
  [[85, 86], "Snow Showers"],
  [[95, 96, 99], "Thunderstorms"],
];

type OpenMeteoResponse = {
  daily?: {
    time?: string[];
    weather_code?: number[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_sum?: number[];
    snowfall_sum?: number[];
    wind_speed_10m_max?: number[];
    wind_speed_10m_mean?: number[];
    temperature_2m_mean?: number[];
  };
};

type CensusGeocodingResponse = {
  result?: {
    addressMatches?: Array<{
      matchedAddress?: string;
      coordinates?: { x?: number; y?: number };
    }>;
  };
};

type OpenMeteoGeocodingResponse = {
  results?: Array<{
    name?: string;
    admin1?: string;
    country_code?: string;
    latitude?: number;
    longitude?: number;
  }>;
};

type NwsPointsResponse = {
  properties?: {
    forecastGridData?: string;
  };
};

type NwsGridValue = {
  validTime?: string;
  value?: number | null;
};

type NwsGridWeatherValue = {
  validTime?: string;
  value?: Array<{
    coverage?: string | null;
    weather?: string | null;
    intensity?: string | null;
  }> | null;
};

type NwsGridResponse = {
  properties?: {
    temperature?: { uom?: string; values?: NwsGridValue[] };
    windSpeed?: { uom?: string; values?: NwsGridValue[] };
    quantitativePrecipitation?: { uom?: string; values?: NwsGridValue[] };
    weather?: { values?: NwsGridWeatherValue[] };
  };
};

type GeocodedAddress = {
  latitude: number;
  longitude: number;
  resolvedAddress: string;
  provider: string;
};

type WeatherResult = {
  conditions: string;
  high: number;
  low: number;
  rain: string;
  snow: string;
  wind: number;
  source: string;
  summary: string;
  provider: string;
  rainfallInches: number;
  averageTemperatureF: number;
  averageWindSpeedMph: number;
  averageConditions: string;
  capturedAt: string;
};

const NWS_HEADERS = {
  Accept: "application/geo+json",
  "User-Agent": "Mefford-Command-Center/1.0 (meffcon.com)",
};

function localDateStartUtc(date: string, timeZone: string) {
  const [year, month, day] = date.split("-").map(Number);
  const target = Date.UTC(year, month - 1, day);
  let guess = target;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  for (let index = 0; index < 3; index += 1) {
    const parts = formatter.formatToParts(new Date(guess));
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((item) => item.type === type)?.value || 0);
    const rendered = Date.UTC(
      part("year"),
      part("month") - 1,
      part("day"),
      part("hour"),
      part("minute"),
      part("second"),
    );
    guess += target - rendered;
  }
  return guess;
}

function nextDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1))
    .toISOString()
    .slice(0, 10);
}

function durationMilliseconds(duration: string) {
  const match = duration.match(/^PT(?:(\d+)H)?(?:(\d+)M)?$/);
  if (!match) return 0;
  return (Number(match[1] || 0) * 60 + Number(match[2] || 0)) * 60 * 1000;
}

function gridSamplesForDate(
  values: NwsGridValue[] | undefined,
  date: string,
  timeZone: string,
) {
  const dayStart = localDateStartUtc(date, timeZone);
  const dayEnd = localDateStartUtc(nextDate(date), timeZone);
  return (values || []).flatMap((item) => {
    const [startText, durationText] = String(item.validTime || "").split("/");
    const start = Date.parse(startText);
    const duration = durationMilliseconds(durationText || "");
    const end = start + duration;
    const overlap = Math.max(0, Math.min(end, dayEnd) - Math.max(start, dayStart));
    const value = Number(item.value);
    return overlap > 0 && duration > 0 && Number.isFinite(value)
      ? [{ value, overlap, duration }]
      : [];
  });
}

function gridWeatherForDate(
  values: NwsGridWeatherValue[] | undefined,
  date: string,
  timeZone: string,
) {
  const dayStart = localDateStartUtc(date, timeZone);
  const dayEnd = localDateStartUtc(nextDate(date), timeZone);
  const weights = new Map<string, number>();
  for (const item of values || []) {
    const [startText, durationText] = String(item.validTime || "").split("/");
    const start = Date.parse(startText);
    const duration = durationMilliseconds(durationText || "");
    const end = start + duration;
    const overlap = Math.max(0, Math.min(end, dayEnd) - Math.max(start, dayStart));
    if (!overlap) continue;
    const condition = item.value?.find((entry) => entry.weather)?.weather;
    const label = condition
      ? condition
          .replaceAll("_", " ")
          .toLowerCase()
          .replace(/\b\w/g, (letter) => letter.toUpperCase())
      : "Fair";
    weights.set(label, (weights.get(label) || 0) + overlap);
  }
  return [...weights.entries()].sort((left, right) => right[1] - left[1])[0]?.[0]
    || "Conditions Recorded";
}

function weightedAverage(samples: Array<{ value: number; overlap: number }>) {
  const weight = samples.reduce((sum, sample) => sum + sample.overlap, 0);
  if (!weight) return Number.NaN;
  return samples.reduce(
    (sum, sample) => sum + sample.value * sample.overlap,
    0,
  ) / weight;
}

async function getNwsWeather(
  location: GeocodedAddress,
  date: string,
  timeZone: string,
): Promise<WeatherResult> {
  const latitude = location.latitude.toFixed(4);
  const longitude = location.longitude.toFixed(4);
  const pointsResponse = await fetch(
    `https://api.weather.gov/points/${latitude},${longitude}`,
    { headers: NWS_HEADERS },
  );
  if (!pointsResponse.ok) {
    throw new Error(`NWS point lookup returned ${pointsResponse.status}`);
  }
  const points = (await pointsResponse.json()) as NwsPointsResponse;
  const gridUrl = new URL(points.properties?.forecastGridData || "");
  if (gridUrl.hostname !== "api.weather.gov") {
    throw new Error("NWS did not return a trusted daily grid URL");
  }
  const gridResponse = await fetch(gridUrl, { headers: NWS_HEADERS });
  if (!gridResponse.ok) {
    throw new Error(`NWS daily grid returned ${gridResponse.status}`);
  }
  const grid = (await gridResponse.json()) as NwsGridResponse;
  const temperatureSamples = gridSamplesForDate(
    grid.properties?.temperature?.values,
    date,
    timeZone,
  );
  const windSamples = gridSamplesForDate(
    grid.properties?.windSpeed?.values,
    date,
    timeZone,
  );
  const rainSamples = gridSamplesForDate(
    grid.properties?.quantitativePrecipitation?.values,
    date,
    timeZone,
  );
  if (!temperatureSamples.length || !windSamples.length) {
    throw new Error("NWS returned incomplete daily grid values");
  }
  const gridAverageCelsius = weightedAverage(temperatureSamples);
  const averageTemperatureF = Math.round(gridAverageCelsius * 9 / 5 + 32);
  const gridAverageWindKmh = weightedAverage(windSamples);
  const averageWindSpeedMph = Math.round(gridAverageWindKmh * 0.621371);
  const rainfallInches = Number(
    (
      rainSamples.reduce(
        (sum, sample) => sum + sample.value * sample.overlap / sample.duration,
        0,
      ) / 25.4
    ).toFixed(2),
  );
  const averageConditions = gridWeatherForDate(
    grid.properties?.weather?.values,
    date,
    timeZone,
  );
  const temperaturesF = temperatureSamples.map(
    (sample) => sample.value * 9 / 5 + 32,
  );
  const windSpeedsMph = windSamples.map((sample) => sample.value * 0.621371);
  const high = Math.round(Math.max(...temperaturesF));
  const low = Math.round(Math.min(...temperaturesF));
  const wind = Math.round(Math.max(...windSpeedsMph));
  return {
    conditions: averageConditions,
    high,
    low,
    rain: rainfallInches.toFixed(2),
    snow: "0.0",
    wind,
    source: "National Weather Service Daily Snapshot",
    summary: `Rainfall ${rainfallInches.toFixed(2)} in · Avg Temp ${averageTemperatureF}°F · Avg Wind ${averageWindSpeedMph} mph · Avg Conditions ${averageConditions}`,
    provider: `weather.gov · ${location.provider}`,
    rainfallInches,
    averageTemperatureF,
    averageWindSpeedMph,
    averageConditions,
    capturedAt: new Date().toISOString(),
  };
}

async function getOpenMeteoWeather(
  location: GeocodedAddress,
  date: string,
  timeZone: string,
  historical: boolean,
): Promise<WeatherResult> {
  const endpoint = historical
    ? "https://archive-api.open-meteo.com/v1/archive"
    : "https://api.open-meteo.com/v1/forecast";
  const url = new URL(endpoint);
  url.searchParams.set("latitude", String(location.latitude));
  url.searchParams.set("longitude", String(location.longitude));
  url.searchParams.set("start_date", date);
  url.searchParams.set("end_date", date);
  url.searchParams.set(
    "daily",
    "weather_code,temperature_2m_max,temperature_2m_min,temperature_2m_mean,precipitation_sum,snowfall_sum,wind_speed_10m_max,wind_speed_10m_mean",
  );
  url.searchParams.set("temperature_unit", "fahrenheit");
  url.searchParams.set("wind_speed_unit", "mph");
  url.searchParams.set("precipitation_unit", "inch");
  url.searchParams.set("timezone", timeZone);

  const response = await fetch(url, {
    headers: { "User-Agent": "Mefford-Command-Center/1.0" },
  });
  if (!response.ok) throw new Error(`Open-Meteo returned ${response.status}`);
  const data = (await response.json()) as OpenMeteoResponse;
  const daily = data.daily;
  if (!daily?.time?.length) throw new Error("Open-Meteo returned no daily weather");
  const code = daily.weather_code?.[0] ?? -1;
  const conditions =
    WEATHER_LABELS.find(([codes]) => codes.includes(code))?.[1] ??
    "Conditions Recorded";
  const high = Math.round(daily.temperature_2m_max?.[0] ?? 0);
  const low = Math.round(daily.temperature_2m_min?.[0] ?? 0);
  const rain = Number(daily.precipitation_sum?.[0] ?? 0).toFixed(2);
  const snow = Number(daily.snowfall_sum?.[0] ?? 0).toFixed(1);
  const wind = Math.round(daily.wind_speed_10m_max?.[0] ?? 0);
  const averageTemperatureF = Math.round(
    daily.temperature_2m_mean?.[0] ?? (high + low) / 2,
  );
  const averageWindSpeedMph = Math.round(
    daily.wind_speed_10m_mean?.[0] ?? wind,
  );
  const rainfallInches = Number(rain);
  return {
    conditions,
    high,
    low,
    rain,
    snow,
    wind,
    source: historical ? "Historical Daily Weather" : "Daily Weather Snapshot",
    summary: `Rainfall ${rain} in · Avg Temp ${averageTemperatureF}°F · Avg Wind ${averageWindSpeedMph} mph · Avg Conditions ${conditions}`,
    provider: `Open-Meteo Weather · ${location.provider}`,
    rainfallInches,
    averageTemperatureF,
    averageWindSpeedMph,
    averageConditions: conditions,
    capturedAt: new Date().toISOString(),
  };
}

function placeQueryFromAddress(address: string) {
  const parts = address.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 3) return parts.at(-2) || address;
  if (parts.length === 2) return parts[0];
  return address
    .replace(/\s+[A-Z]{2}(?:\s+\d{5}(?:-\d{4})?)?$/i, "")
    .trim() || address;
}

function normalizeProjectAddress(address: string) {
  const compact = address
    .replace(/[\r\n]+/g, ", ")
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/,+/g, ",")
    .trim()
    .replace(/^,|,$/g, "")
    .trim();
  return /(?:\bUSA\b|\bUnited States\b)$/i.test(compact) ? compact : `${compact}, USA`;
}

function addressQueryCandidates(address: string) {
  const normalized = normalizeProjectAddress(address);
  const withoutUnit = normalized
    .replace(/,?\s+(?:APT|APARTMENT|UNIT|SUITE|STE|BLDG|BUILDING|FLOOR|FL|#)\s*[A-Z0-9-]+(?=,|$)/i, "")
    .replace(/\s*,\s*/g, ", ");
  const zip = normalized.match(/\b\d{5}(?:-\d{4})?\b/)?.[0] || "";
  const place = placeQueryFromAddress(normalized);
  return [...new Set([normalized, withoutUnit, place, zip].map((value) => value.trim()).filter((value) => value.length >= 3))];
}

async function geocodeAddress(address: string): Promise<GeocodedAddress> {
  const candidates = addressQueryCandidates(address);
  for (const candidate of candidates.slice(0, 2)) {
    const censusUrl = new URL(
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress",
    );
    censusUrl.searchParams.set("address", candidate);
    censusUrl.searchParams.set("benchmark", "Public_AR_Current");
    censusUrl.searchParams.set("format", "json");
    try {
      const response = await fetch(censusUrl, {
        headers: { "User-Agent": "Mefford-Command-Center/1.0" },
      });
      if (response.ok) {
        const data = (await response.json()) as CensusGeocodingResponse;
        const match = data.result?.addressMatches?.[0];
        const longitude = Number(match?.coordinates?.x);
        const latitude = Number(match?.coordinates?.y);
        if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
          return {
            latitude,
            longitude,
            resolvedAddress: match?.matchedAddress || candidate,
            provider: "U.S. Census Geocoder",
          };
        }
      }
    } catch {
      // Place and postal-code candidates below keep automatic weather available.
    }
  }

  for (const candidate of candidates.slice(2)) {
    const placeUrl = new URL("https://geocoding-api.open-meteo.com/v1/search");
    placeUrl.searchParams.set("name", candidate);
    placeUrl.searchParams.set("count", "10");
    placeUrl.searchParams.set("language", "en");
    placeUrl.searchParams.set("format", "json");
    const placeResponse = await fetch(placeUrl, { headers: { "User-Agent": "Mefford-Command-Center/1.0" } });
    if (!placeResponse.ok) continue;
    const placeData = (await placeResponse.json()) as OpenMeteoGeocodingResponse;
    const match = placeData.results?.find((result) => Number.isFinite(result.latitude) && Number.isFinite(result.longitude));
    if (match && Number.isFinite(match.latitude) && Number.isFinite(match.longitude)) {
      return {
        latitude: match.latitude!,
        longitude: match.longitude!,
        resolvedAddress: [match.name, match.admin1, match.country_code].filter(Boolean).join(", "),
        provider: "Open-Meteo Place Search",
      };
    }
  }
  throw new Error("No address match was returned");
}

export async function GET(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated) return Response.json({ error: "Authentication required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  const search = new URL(request.url).searchParams;
  const address = search.get("address")?.trim() ?? "";
  const date = search.get("date")?.trim() ?? "";
  const requestedTimeZone = search.get("timeZone")?.trim() || "America/New_York";
  const timeZone = /^[A-Za-z_]+(?:\/[A-Za-z0-9_+.-]+)+$/.test(requestedTimeZone) && requestedTimeZone.length <= 80
    ? requestedTimeZone
    : "America/New_York";
  if (address.length < 3 || address.length > 300 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json(
      { error: "A valid project address and date are required" },
      { status: 400 },
    );
  }

  let location: GeocodedAddress;
  try {
    location = await geocodeAddress(address);
  } catch (error) {
    await recordFirstPartyFailure({
      route: "/api/weather",
      status: 422,
      reason: error instanceof Error ? error.message : "Address geocoding failed",
      actorEmail: actor.email,
    });
    return Response.json(
      {
        error:
          "The project address could not be located. Confirm the address or enter weather manually.",
      },
      { status: 422 },
    );
  }

  const selectedDay = Date.parse(`${date}T12:00:00Z`);
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const historical = selectedDay < sevenDaysAgo;
  const providerFailures: string[] = [];
  let weather: WeatherResult | null = null;

  if (!historical) {
    try {
      weather = await getNwsWeather(location, date, timeZone);
    } catch (error) {
      const message = error instanceof Error ? error.message : "NWS forecast failed";
      providerFailures.push(message);
      console.warn("National Weather Service daily snapshot failed", message);
    }
  }
  if (!weather) {
    try {
      weather = await getOpenMeteoWeather(location, date, timeZone, historical);
    } catch (error) {
      providerFailures.push(
        error instanceof Error ? error.message : "Open-Meteo forecast failed",
      );
    }
  }
  if (!weather) {
    console.error("Project weather providers failed", providerFailures.join(" | "));
    await recordFirstPartyFailure({
      route: "/api/weather",
      status: 502,
      reason: providerFailures.join(" | ") || "Every weather provider failed",
      actorEmail: actor.email,
    });
    return Response.json(
      { error: "Project weather is temporarily unavailable. Manual entry remains available." },
      {
        status: 502,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  return Response.json(
    {
      date,
      address,
      resolvedAddress: location.resolvedAddress,
      ...weather,
    },
    { headers: { "Cache-Control": "private, max-age=900", Vary: "Cookie" } },
  );
}
