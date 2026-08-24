import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

type MetricType = "time" | "distance" | "weight";
type Performance = {
  id: string;
  athlete_name: string;
  discipline: string;
  category: string | null;
  season: string | null;
  metric_type: MetricType;
  performance_value: number | null;
  performance_display: string;
  result_date: string | null;
  competition_name: string | null;
  source?: "database" | "official-file";
};

const OFFICIAL_FILES = [
  "https://raw.githubusercontent.com/jesusspf-pixel/atletas-de-fuenlabrada/main/data/official-results/fam-ranking-2025.json",
  "https://raw.githubusercontent.com/jesusspf-pixel/atletas-de-fuenlabrada/main/data/official-results/fam-event-2025-02-16-jornada-menores-aluche.json",
  "https://raw.githubusercontent.com/jesusspf-pixel/atletas-de-fuenlabrada/main/data/official-results/fam-event-2025-01-26-reunion-fam15-gallur.json",
  "https://raw.githubusercontent.com/jesusspf-pixel/atletas-de-fuenlabrada/main/data/official-results/fam-event-2025-06-14-reunion-san-juan-leganes.json"
];

function categoryLabel(value: string | null | undefined) {
  const normalized = String(value || "").toUpperCase().replace(/\s/g, "");
  const match = normalized.match(/(?:U|SUB)(8|10|12|14|16|18|20|23)/);
  if (match) return `Sub ${match[1]}`;
  if (/MASTER|M[3-9]/.test(normalized)) return "Máster";
  if (/ABS|SEN/.test(normalized)) return "Absoluto";
  return value || "Sin categoría";
}

function metricFromUnit(unit: string | null | undefined): MetricType {
  const normalized = String(unit || "").toLowerCase();
  if (normalized === "s" || normalized.includes("sec")) return "time";
  if (normalized === "kg" || normalized.includes("kilo")) return "weight";
  return "distance";
}

function isBetter(next: Performance, current: Performance) {
  if (next.performance_value === null) return false;
  if (current.performance_value === null) return true;
  if (next.metric_type === "time") return next.performance_value < current.performance_value;
  return next.performance_value > current.performance_value;
}

async function fetchOfficialFallback(): Promise<Performance[]> {
  const files = await Promise.all(OFFICIAL_FILES.map(async (url) => {
    const response = await fetch(url);
    if (!response.ok) return { rows: [], source: { name: "Resultado FAM" } };
    return response.json() as Promise<{ rows?: Array<Record<string, unknown>>; source?: { name?: string } }>;
  }));
  return files.flatMap((file, sourceIndex) => (file.rows || []).map((row, index) => ({
    id: String(row.external_row_id || `fam-static-${sourceIndex}-${index}`),
    athlete_name: String(row.athlete_name || "Atleta"),
    discipline: String(row.event_name || row.event_code || "Prueba oficial"),
    category: categoryLabel(row.category_label as string | null),
    season: String(row.competition_date || "").slice(0, 4) || "2025",
    metric_type: metricFromUnit(row.result_unit as string | null),
    performance_value: typeof row.result_value === "number" ? row.result_value : null,
    performance_display: String(row.result_text || "Resultado"),
    result_date: String(row.competition_date || "") || null,
    competition_name: String(file.source?.name || "Resultado oficial FAM"),
    source: "official-file" as const
  })));
}

export default function HistoricalRanking() {
  const [rows, setRows] = useState<Performance[]>([]);
  const [discipline, setDiscipline] = useState("");
  const [category, setCategory] = useState("");
  const [season, setSeason] = useState("");

  useEffect(() => {
    let alive = true;
    void (async () => {
      const databaseRows: Performance[] = [];
      if (supabase) {
        const { data } = await supabase
          .from("official_performances")
          .select("id,discipline,category,season,metric_type,performance_value,performance_display,result_date,competition_name,historical_athletes(canonical_name)")
          .eq("review_status", "reviewed");
        for (const row of (data || []) as Array<Record<string, unknown>>) {
          const athlete = row.historical_athletes as { canonical_name?: string } | null;
          databaseRows.push({
            id: String(row.id),
            athlete_name: athlete?.canonical_name || "Atleta",
            discipline: String(row.discipline || "Prueba oficial"),
            category: categoryLabel(row.category as string | null),
            season: row.season ? String(row.season) : null,
            metric_type: row.metric_type as MetricType,
            performance_value: typeof row.performance_value === "number" ? row.performance_value : null,
            performance_display: String(row.performance_display || "Resultado"),
            result_date: row.result_date ? String(row.result_date) : null,
            competition_name: row.competition_name ? String(row.competition_name) : null,
            source: "database"
          });
        }
      }
      const fallback = databaseRows.length ? [] : await fetchOfficialFallback();
      if (alive) setRows(databaseRows.length ? databaseRows : fallback);
    })();
    return () => { alive = false; };
  }, []);

  const disciplines = useMemo(() => [...new Set(rows.map(row => row.discipline))].sort((a, b) => a.localeCompare(b, "es")), [rows]);
  const categories = useMemo(() => [...new Set(rows.map(row => row.category).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, "es")), [rows]);
  const seasons = useMemo(() => [...new Set(rows.map(row => row.season).filter(Boolean) as string[])].sort().reverse(), [rows]);

  const ranked = useMemo(() => {
    const matching = rows.filter(row => (!discipline || row.discipline === discipline) && (!category || row.category === category) && (!season || row.season === season));
    const bestByAthlete = new Map<string, Performance>();
    for (const row of matching) {
      const key = row.athlete_name + "|" + row.discipline + "|" + (row.category || "") + "|" + (row.season || "");
      const current = bestByAthlete.get(key);
      if (!current || isBetter(row, current)) bestByAthlete.set(key, row);
    }
    return [...bestByAthlete.values()].sort((left, right) => {
      if (left.performance_value === null) return 1;
      if (right.performance_value === null) return -1;
      return left.metric_type === "time" ? left.performance_value - right.performance_value : right.performance_value - left.performance_value;
    }).slice(0, 20);
  }, [rows, discipline, category, season]);

  return <section>
    <div className="page-head"><div><h1>Ranking histórico</h1><p>Top 20 del club por prueba, categoría y temporada. Se muestra la mejor marca de cada atleta.</p></div></div>
    <article className="panel inline-form">
      <label>Prueba<select value={discipline} onChange={event => setDiscipline(event.target.value)}><option value="">Todas las pruebas</option>{disciplines.map(value => <option value={value} key={value}>{value}</option>)}</select></label>
      <label>Categoría<select value={category} onChange={event => setCategory(event.target.value)}><option value="">Todas las categorías</option>{categories.map(value => <option value={value} key={value}>{value}</option>)}</select></label>
      <label>Temporada<select value={season} onChange={event => setSeason(event.target.value)}><option value="">Todas las temporadas</option>{seasons.map(value => <option value={value} key={value}>{value}</option>)}</select></label>
    </article>
    <article className="panel table historical-top">{ranked.map((row, index) => <div className={"row historical-rank " + (index < 8 ? "top-eight" : "")} key={row.id}>
      <span><b>{index < 8 ? "★ " : "#"}{index + 1} · {row.athlete_name}</b><small>{row.discipline} · {row.category || "Categoría sin indicar"} · {row.season || "Temporada"}</small></span>
      <span><b>{row.performance_display}</b><small>{index < 8 ? "TOP 8 HISTÓRICO" : "Top 20 histórico"}</small></span>
      <span>{row.competition_name || "Resultado oficial"}<small>{row.result_date ? new Date(row.result_date + "T00:00:00").toLocaleDateString("es-ES") : ""}</small></span>
    </div>)}{!ranked.length && <div className="empty">Aún no hay resultados oficiales publicados para este filtro.</div>}</article>
  </section>;
}
