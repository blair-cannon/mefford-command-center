import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const api = fs.readFileSync(new URL("../app/api/weather/route.ts", import.meta.url), "utf8");

test("project weather is requested by saved address instead of coordinates", () => {
  assert.match(page, /address: projectWeatherAddress/);
  assert.match(page, /const projectWeatherAddress = projectProfile\.site\.trim\(\)/);
  assert.doesNotMatch(page, /Project Coordinates Required For Automatic Weather/);
  assert.match(api, /search\.get\("address"\)/);
  assert.doesNotMatch(api, /search\.get\("latitude"\)/);
  assert.doesNotMatch(api, /search\.get\("longitude"\)/);
});

test("weather geocodes a street address and falls back to city or place lookup", () => {
  assert.match(api, /geocoding\.geo\.census\.gov\/geocoder\/locations\/onelineaddress/);
  assert.match(api, /geocoding-api\.open-meteo\.com\/v1\/search/);
  assert.match(api, /A valid project address and date are required/);
  assert.match(api, /resolvedAddress/);
  assert.match(api, /normalizeProjectAddress/);
  assert.match(api, /addressQueryCandidates/);
  assert.match(api, /APT\|APARTMENT\|UNIT\|SUITE\|STE/);
});

test("current U.S. weather uses the National Weather Service before the historical fallback", () => {
  assert.match(api, /https:\/\/api\.weather\.gov\/points\//);
  assert.match(api, /National Weather Service Daily Snapshot/);
  assert.match(api, /weather\.gov · \$\{location\.provider\}/);
  assert.match(api, /weather = await getNwsWeather/);
  assert.match(api, /weather = await getOpenMeteoWeather/);
  assert.ok(
    api.indexOf("weather = await getNwsWeather") <
      api.indexOf("weather = await getOpenMeteoWeather"),
  );
  assert.match(api, /Cache-Control": "no-store"/);
});

test("daily weather returns the four values required by a locked Daily Log", () => {
  assert.match(api, /forecastGridData/);
  assert.match(api, /quantitativePrecipitation/);
  assert.match(api, /rainfallInches/);
  assert.match(api, /averageTemperatureF/);
  assert.match(api, /averageWindSpeedMph/);
  assert.match(api, /averageConditions/);
  assert.match(api, /Rainfall \$\{rainfallInches\.toFixed\(2\)\} in/);
});

test("employee weather cards show conditions without provider or geocoding details", () => {
  const card = page.slice(page.indexOf('className="weather-card"'), page.indexOf("</button>", page.indexOf('className="weather-card"')));
  assert.match(card, /projectWeather\.conditions/);
  assert.match(card, /Open Daily Weather/);
  assert.doesNotMatch(card, /projectWeather\.source|provider|geocod|weather\.gov|Open-Meteo/i);
  const details = page.slice(page.indexOf('className="stored-record-details"'), page.indexOf("</section>", page.indexOf('className="stored-record-details"')));
  assert.match(details, /key !== "weatherSource"/);
});
