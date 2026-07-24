/**
 * A small league/country badge beats a plain colored square, and robotip
 * already hosts exactly what's needed:
 *  - `robotip_imgs/flags/{iso2}.png` — a real flag per country (this is the
 *    same country-name list robotip's own UI uses internally, reverse
 *    engineered from their bundle's country dropdown + verified against the
 *    actual `country` values their /api/ligas endpoint returns).
 *  - `robotip_imgs/imgs_logos/small/{id_liga}.png` — a real competition logo
 *    for international competitions (`league_country` is "World"/"Europe"
 *    for those, there's no single country to flag). Not every competition
 *    has one; missing ones 404 with a tiny error body, so each league_id is
 *    checked once (HEAD request) and cached, falling back to a generic
 *    globe icon (`flags/wrd.png`, robotip's own "no specific country" flag).
 */

const ROBOTIP_PUBLIC_URL = process.env.GAMES_LIVE_ROBOTIP_URL ?? "https://robotip.com.br";
const LOGO_CHECK_TIMEOUT_MS = 5_000;
const LOGO_CACHE_TTL_MS = 24 * 60 * 60_000;

const WORLD_FLAG_URL = `${ROBOTIP_PUBLIC_URL}/robotip_imgs/flags/wrd.png`;

// league_country -> ISO 3166-1 alpha-2, covering every country string seen
// across robotip's /api/ligas dump. "World" and "Europe" (confederation/
// international competitions with no single country) are handled separately
// via the per-competition logo lookup below.
const COUNTRY_TO_FLAG: Record<string, string> = {
  Albania: "al",
  Algeria: "dz",
  Andorra: "ad",
  Angola: "ao",
  "Antigua and Barbuda": "ag",
  Argentina: "ar",
  Armenia: "am",
  Aruba: "aw",
  Australia: "au",
  Austria: "at",
  Azerbaijan: "az",
  Bahamas: "bs",
  Bahrain: "bh",
  Bangladesh: "bd",
  Barbados: "bb",
  Belarus: "by",
  Belgium: "be",
  Belize: "bz",
  Benin: "bj",
  Bhutan: "bt",
  Bolivia: "bo",
  "Bosnia & Herzegovina": "ba",
  Botswana: "bw",
  Brazil: "br",
  Brunei: "bn",
  Bulgaria: "bg",
  "Burkina Faso": "bf",
  Burundi: "bi",
  Cambodia: "kh",
  Cameroon: "cm",
  Canada: "ca",
  "Cayman Islands": "ky",
  Chile: "cl",
  China: "cn",
  Colombia: "co",
  Comoros: "km",
  "Congo - Brazzaville": "cg",
  "Congo - Kinshasa": "cd",
  "Costa Rica": "cr",
  Croatia: "hr",
  Cuba: "cu",
  Curaçao: "cw",
  Cyprus: "cy",
  "Czech Republic": "cz",
  "Côte d’Ivoire": "ci",
  Denmark: "dk",
  Djibouti: "dj",
  Dominica: "dm",
  "Dominican Republic": "do",
  Ecuador: "ec",
  Egypt: "eg",
  "El Salvador": "sv",
  England: "gb-eng",
  Estonia: "ee",
  Ethiopia: "et",
  "Faroe Islands": "fo",
  Fiji: "fj",
  Finland: "fi",
  France: "fr",
  "French Guiana": "gf",
  Gabon: "ga",
  Gambia: "gm",
  Georgia: "ge",
  Germany: "de",
  Ghana: "gh",
  Gibraltar: "gi",
  "Great Britain": "gb",
  Greece: "gr",
  Grenada: "gd",
  Guadeloupe: "gp",
  Guatemala: "gt",
  Guinea: "gn",
  Guyana: "gy",
  Haiti: "ht",
  Honduras: "hn",
  "Hong Kong SAR China": "hk",
  Hungary: "hu",
  Iceland: "is",
  India: "in",
  Indonesia: "id",
  Iran: "ir",
  Iraq: "iq",
  Ireland: "ie",
  Israel: "il",
  Italy: "it",
  Jamaica: "jm",
  Japan: "jp",
  Jordan: "jo",
  Kazakhstan: "kz",
  Kenya: "ke",
  Kosovo: "xk",
  Kuwait: "kw",
  Kyrgyzstan: "kg",
  Laos: "la",
  Latvia: "lv",
  Lebanon: "lb",
  Lesotho: "ls",
  Liberia: "lr",
  Libya: "ly",
  Liechtenstein: "li",
  Lithuania: "lt",
  Luxembourg: "lu",
  "Macau SAR China": "mo",
  Macedonia: "mk",
  Madagascar: "mg",
  Malawi: "mw",
  Malaysia: "my",
  Maldives: "mv",
  Mali: "ml",
  Malta: "mt",
  Mauritania: "mr",
  Mauritius: "mu",
  Mexico: "mx",
  Moldova: "md",
  Mongolia: "mn",
  Montenegro: "me",
  Morocco: "ma",
  Mozambique: "mz",
  "Myanmar (Burma)": "mm",
  Namibia: "na",
  Nepal: "np",
  Netherlands: "nl",
  "New Caledonia": "nc",
  "New Zealand": "nz",
  "Northern Ireland": "gb-nir",
  Nicaragua: "ni",
  Niger: "ne",
  Nigeria: "ng",
  Norway: "no",
  Oman: "om",
  Pakistan: "pk",
  "Palestinian Territories": "ps",
  Panama: "pa",
  "Papua New Guinea": "pg",
  Paraguay: "py",
  Peru: "pe",
  Philippines: "ph",
  Poland: "pl",
  Portugal: "pt",
  "Puerto Rico": "pr",
  Qatar: "qa",
  Romania: "ro",
  Russia: "ru",
  Rwanda: "rw",
  "Saint Kitts and Nevis": "kn",
  "Saint Lucia": "lc",
  Samoa: "ws",
  "San Marino": "sm",
  "Saudi Arabia": "sa",
  Scotland: "gb-sct",
  Senegal: "sn",
  Serbia: "rs",
  Seychelles: "sc",
  "Sierra Leone": "sl",
  Singapore: "sg",
  Slovakia: "sk",
  Slovenia: "si",
  "Solomon Islands": "sb",
  "South Africa": "za",
  "South Korea": "kr",
  Spain: "es",
  "Sri Lanka": "lk",
  Sudan: "sd",
  Suriname: "sr",
  Sweden: "se",
  Switzerland: "ch",
  Syria: "sy",
  Taiwan: "tw",
  Tajikistan: "tj",
  Tanzania: "tz",
  Thailand: "th",
  Togo: "tg",
  "Trinidad and Tobago": "tt",
  Tunisia: "tn",
  Turkey: "tr",
  Turkmenistan: "tm",
  USA: "us",
  Uganda: "ug",
  Ukraine: "ua",
  "United Arab Emirates": "ae",
  Uruguay: "uy",
  Uzbekistan: "uz",
  Vanuatu: "vu",
  Venezuela: "ve",
  Vietnam: "vn",
  Wales: "gb-wls",
  Yemen: "ye",
  Zambia: "zm",
  Zimbabwe: "zw",
};

/** No single country for an international/confederation competition — try its own logo. */
const NO_COUNTRY_VALUES = new Set(["World", "Europe"]);

const logoExistsCache = new Map<string, { exists: boolean; checkedAt: number }>();

async function competitionLogoExists(leagueId: string): Promise<boolean> {
  const cached = logoExistsCache.get(leagueId);
  if (cached && Date.now() - cached.checkedAt < LOGO_CACHE_TTL_MS) return cached.exists;

  let exists = false;
  try {
    const res = await fetch(`${ROBOTIP_PUBLIC_URL}/robotip_imgs/imgs_logos/small/${leagueId}.png`, {
      method: "HEAD",
      signal: AbortSignal.timeout(LOGO_CHECK_TIMEOUT_MS),
    });
    exists = res.ok;
  } catch {
    exists = false;
  }
  logoExistsCache.set(leagueId, { exists, checkedAt: Date.now() });
  return exists;
}

/** Resolves the small badge image for one league: its competition logo (international), its
 * country's flag (domestic), or the generic globe icon when neither is available. */
export async function resolveLeagueImageUrl(leagueCountry: string | null, leagueId: string): Promise<string> {
  if (leagueCountry && NO_COUNTRY_VALUES.has(leagueCountry)) {
    return (await competitionLogoExists(leagueId))
      ? `${ROBOTIP_PUBLIC_URL}/robotip_imgs/imgs_logos/small/${leagueId}.png`
      : WORLD_FLAG_URL;
  }
  const code = leagueCountry ? COUNTRY_TO_FLAG[leagueCountry] : undefined;
  return code ? `${ROBOTIP_PUBLIC_URL}/robotip_imgs/flags/${code}.png` : WORLD_FLAG_URL;
}
