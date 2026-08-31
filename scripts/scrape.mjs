// Scrapes Cineplex's undocumented theatrical API for IMAX showtimes at each
// theatre listed in data/theatres.json and writes one data/<slug>.json per
// theatre.
//
// The API is unofficial (reverse-engineered from Cineplex's own JS bundle).
// If it starts failing entirely for a theatre, we skip writing that
// theatre's file so we never clobber its last known-good data with
// empty/broken output.

const SUBSCRIPTION_KEY =
  process.env.CINEPLEX_SUBSCRIPTION_KEY || "dcdac5601d864addbc2675a2e96cb1f8";
const API_BASE = "https://apis.cineplex.com/prod/cpx/theatrical/api/v1";
// Cineplex publishes a contiguous ~10-day window of regular showtimes, but
// also opens advance ticket sales for big releases (e.g. tentpole IMAX
// events) on scattered dates many months out. There's no way to know where
// those advance-sale dates are without probing, so we scan a full year
// ahead and just keep whatever comes back non-empty.
const DAYS_AHEAD = 365;
const CONCURRENCY = 8;
const THEATRES_PATH = new URL("../data/theatres.json", import.meta.url);

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

async function fetchShowtimesForDate(theatreId, dateStr) {
  const url = `${API_BASE}/showtimes?language=en&locationId=${theatreId}&date=${dateStr}`;
  const res = await fetch(url, {
    headers: { "Ocp-Apim-Subscription-Key": SUBSCRIPTION_KEY },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${dateStr}`);
  }
  const text = await res.text();
  if (!text) return null; // no data published for this date yet
  return JSON.parse(text);
}

function extractImaxMovies(theatreEntry) {
  const dateEntry = theatreEntry?.dates?.[0];
  if (!dateEntry) return [];

  const movies = [];
  for (const movie of dateEntry.movies ?? []) {
    const sessions = [];
    for (const experience of movie.experiences ?? []) {
      const experienceTypes = experience.experienceTypes ?? [];
      if (!experienceTypes.includes("IMAX")) continue;
      const format = experienceTypes.join(" ");
      for (const session of experience.sessions ?? []) {
        if (session.isInThePast) continue;
        const time = session.showStartDateTime?.slice(11, 16); // HH:MM
        if (!time) continue;
        sessions.push({
          time,
          format,
          ticketUrl: session.deeplinkUrl || session.ticketingUrl || null,
          //vistaSessionId: session.vistaSessionId ?? null,
          //areaCode: session.areaCode ?? null,
          // seatDataEligible: Boolean(
          //   session.isReservedSeating &&
          //     session.isShowtimeEnabledOnline &&
          //     !session.isSoldOut &&
          //     session.vistaSessionId &&
          //     session.areaCode
          // ),
        });
      }
    }
    if (sessions.length === 0) continue;
    sessions.sort((a, b) => a.time.localeCompare(b.time));
    movies.push({
      title: movie.name,
      poster: movie.mediumPosterImageUrl || movie.smallPosterImageUrl || null,
      runtimeMinutes: movie.runtimeInMinutes ?? null,
      sessions,
    });
  }
  return movies;
}





async function processDate(theatreId, dateStr) {
  try {
    const payload = await fetchShowtimesForDate(theatreId, dateStr);
    if (!payload) return { dateStr, ok: true, movies: [] };
    const theatreEntry = Array.isArray(payload) ? payload[0] : payload;
    const movies = extractImaxMovies(theatreEntry);
    return { dateStr, ok: true, movies };
  } catch (err) {
    console.warn(`Skipping ${dateStr}: ${err.message}`);
    return { dateStr, ok: false, movies: [] };
  }
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}

// Returns true if this theatre's file was written, false if it was skipped
// (every date request failed, so we leave the existing file untouched).
async function scrapeTheatre(theatre, { mkdir, writeFile }) {
  const today = new Date();
  const dateStrs = Array.from({ length: DAYS_AHEAD }, (_, i) => {
    const date = new Date(today);
    date.setDate(date.getDate() + i);
    return formatDate(date);
  });

  const results = await mapWithConcurrency(dateStrs, CONCURRENCY, (dateStr) =>
    processDate(theatre.id, dateStr)
  );

  const successCount = results.filter((r) => r.ok).length;
  if (successCount === 0) {
    console.error(
      `Every date request failed for ${theatre.name}; leaving existing data untouched.`
    );
    return false;
  }

  const days = results
    .filter((r) => r.movies.length > 0)
    .map((r) => ({ date: r.dateStr, movies: r.movies }));

  //const auditoriums = await attachSeatData(theatre.id, days);

  const output = {
    updatedAt: new Date().toISOString(),
    theatre: { id: theatre.id, name: theatre.name },
    //auditoriums,
    days,
  };

  const outputPath = new URL(`../${theatre.file}`, import.meta.url);
  await mkdir(new URL("../data", import.meta.url), { recursive: true });
  await writeFile(outputPath, JSON.stringify(output, null, 2) + "\n");

  console.log(
    `Wrote ${days.length} day(s) with IMAX showtimes to ${theatre.file}`
  );
  return true;
}

async function main() {
  const { readFile, mkdir, writeFile } = await import("node:fs/promises");
  const theatres = JSON.parse(await readFile(THEATRES_PATH, "utf8"));

  let anySucceeded = false;
  for (const theatre of theatres) {
    const wrote = await scrapeTheatre(theatre, { mkdir, writeFile });
    anySucceeded = anySucceeded || wrote;
  }

  if (!anySucceeded) {
    console.error("Every theatre failed entirely; nothing was written.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});