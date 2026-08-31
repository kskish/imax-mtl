const fs = require("node:fs");

const rawData = JSON.parse(
  fs.readFileSync("cineplex-response.json", "utf8")
);

const theatres = rawData.map(theatre => {
  const movies = theatre.dates.flatMap(date =>
    date.movies.flatMap(movie =>
      movie.experiences
        .filter(experience =>
          experience.experienceTypes.some(type =>
            type.toLowerCase().includes("imax")
          )
        )
        .map(experience => ({
          title: movie.name,
          movieUrl: movie.detailPageUrl,
          posterUrl: movie.mediumPosterImageUrl,
          rating: movie.localRating,
          runtimeInMinutes: movie.runtimeInMinutes,
          format: experience.experienceTypes,
          sessions: experience.sessions.map(session => ({
            startsAt: session.showStartDateTime,
            auditorium: session.auditorium,
            seatsRemaining: session.seatsRemaining,
            soldOut: session.isSoldOut,
            seatMapUrl: session.seatMapUrl,
            ticketingUrl: session.ticketingUrl
          }))
        }))
    )
  );

  return {
    name: theatre.theatre,
    theatreId: theatre.theatreId,
    movies
  };
});

const output = {
  updatedAt: new Date().toISOString(),
  theatres
};

fs.writeFileSync(
  "showtimes.json",
  JSON.stringify(output, null, 2)
);

console.log("Created showtimes.json");