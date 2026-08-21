import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

type ChallengeRow = {
  athlete_id: string;
  first_name: string;
  last_name: string;
  group_name: string | null;
  activities: number;
  distance_m: number;
  moving_time_s: number;
  elevation_gain_m: number;
  pace_seconds_per_km: number | null;
};

type Achievement = { id: string; athlete_id: string; title: string; description: string | null; earned_at: string };

const pace = (seconds: number | null) => {
  if (!seconds || !Number.isFinite(seconds)) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}/km`;
};

export default function ClubChallenge({ athleteId }: { athleteId?: string }) {
  const [rows, setRows] = useState<ChallengeRow[]>([]);
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [filter, setFilter] = useState<"club" | "group">("club");
  const [groupName, setGroupName] = useState<string | null>(null);

  useEffect(() => {
    const client = supabase; if (!client) return;
    void Promise.all([
      client.from("club_challenge_weekly").select("*").order("distance_m", { ascending: false }),
      athleteId ? client.from("athlete_achievements").select("id,athlete_id,title,description,earned_at").eq("athlete_id", athleteId).order("earned_at", { ascending: false }).limit(12) : Promise.resolve({ data: [] }),
      athleteId ? client.from("athletes").select("training_groups(name)").eq("id", athleteId).maybeSingle() : Promise.resolve({ data: null }),
    ]).then(([challenge, achievementRows, athlete]) => {
      setRows((challenge.data ?? []) as ChallengeRow[]);
      setAchievements((achievementRows.data ?? []) as Achievement[]);
      const relation = athlete.data as { training_groups?: { name?: string } | { name?: string }[] | null } | null;
      const value = Array.isArray(relation?.training_groups) ? relation?.training_groups?.[0]?.name : relation?.training_groups?.name;
      setGroupName(value ?? null);
    });
  }, [athleteId]);

  const visible = useMemo(() => filter === "group" && groupName ? rows.filter(row => row.group_name === groupName) : rows, [rows, filter, groupName]);
  const total = visible.reduce((sum, row) => sum + Number(row.distance_m || 0), 0) / 1000;

  return <section className="club-challenge">
    <article className="panel">
      <div className="table-title"><div><h2>🏆 Club Challenge</h2><p>Clasificación semanal entre atletas que han activado voluntariamente su participación.</p></div><div className="challenge-tabs"><button className={filter === "club" ? "selected-row" : "outline"} onClick={() => setFilter("club")}>Todo el club</button>{groupName && <button className={filter === "group" ? "selected-row" : "outline"} onClick={() => setFilter("group")}>Mi grupo</button>}</div></div>
      <div className="metric-grid"><article className="metric"><small>Kilómetros del reto</small><b>{total.toFixed(1)} km</b><small>Esta semana</small></article><article className="metric"><small>Atletas participantes</small><b>{visible.length}</b><small>Con actividad compartida</small></article><article className="metric"><small>Grupos</small><b>{new Set(visible.map(row => row.group_name).filter(Boolean)).size}</b><small>Participando</small></article></div>
      {visible.length ? <div className="table challenge-table">{visible.slice(0, 50).map((row, index) => <div className={`row ${row.athlete_id === athleteId ? "selected-row" : ""}`} key={row.athlete_id}><span><b>{index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : `${index + 1}.`} {row.first_name} {row.last_name}</b><small>{row.group_name || "Sin grupo"}</small></span><span><b>{(Number(row.distance_m || 0) / 1000).toFixed(1)} km</b><small>{row.activities} actividad(es)</small></span><span><b>{pace(row.pace_seconds_per_km)}</b><small>+{Math.round(Number(row.elevation_gain_m || 0))} m</small></span></div>)}</div> : <p>Aún no hay actividades compartidas esta semana.</p>}
    </article>
    {athleteId && <article className="panel"><h2>Logros</h2>{achievements.length ? <div className="achievement-grid">{achievements.map(item => <article className="achievement" key={item.id}><b>🏅 {item.title}</b>{item.description && <p>{item.description}</p>}<small>{new Date(item.earned_at).toLocaleDateString("es-ES")}</small></article>)}</div> : <p>Aún no hay logros desbloqueados. La actividad del Club Challenge irá generándolos.</p>}</article>}
  </section>;
}
