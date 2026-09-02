import "./challenge-icons.css";

/**
 * Strava review build.
 *
 * Club-wide leaderboards are intentionally disabled because they would expose
 * Strava-derived metrics to people other than the athlete who authorised the
 * connection. The production application is not affected by this branch.
 */
export default function ClubChallenge(_props: { athleteId?: string }) {
  return (
    <section className="club-challenge challenge-v2-live">
      <article className="panel">
        <small>PRIVACIDAD DE DATOS CONECTADOS</small>
        <h2>Challenge independiente de Strava</h2>
        <p>
          Las actividades importadas desde Strava son privadas y no se utilizan
          para clasificaciones, retos colectivos ni perfiles de otros atletas.
        </p>
        <p>
          Los retos del club se alimentarán únicamente de registros propios de
          la plataforma cuando el atleta decida participar.
        </p>
      </article>
    </section>
  );
}
