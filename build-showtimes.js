const fs = require("node:fs");
const rawData = JSON.parse(
  fs.readFileSync("data/scotiabank-montreal.json", "utf8"),
);
const theatre = {
  name: rawData.theatre.name,
  theatreId: rawData.theatre.id,
  movies: rawData.days.flatMap((day) =>
    day.movies.map((movie) => ({
      title: movie.title,
      posterUrl: movie.poster,
      runtimeInMinutes: movie.runtimeMinutes,
      format: [...new Set(movie.sessions.map((session) => session.format))],
      sessions: movie.sessions.map((session) => ({
        date: day.date,
        startsAt: `${day.date}T${session.time}`,
        format: session.format,
        ticketingUrl: session.ticketUrl,
      })),
    })),
  ),
};
const output = { updatedAt: new Date().toISOString(), theatres: [theatre] };
fs.writeFileSync("showtimes.json", JSON.stringify(output, null, 2));
console.log("Created showtimes.json");
