import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { verifiedOfficialResults } from "../data/verifiedOfficialResults";

type MetricType = "time" | "distance" | "weight";
type Performance = {
  id: string; athlete_name: string; discipline: string; category: string | null; season: string | null;
  metric_type: MetricType; performance_value: number | null; performance_display: string;
  sex: "M" | "F" | null; result_date: string | null; competition_name: string | null;
};

const categoryOrder = ["Absoluto", "Sub 23", "Sub 20", "Sub 18", "Sub 16", "Sub 14", "Sub 12", "Sub 10", "Sub 8", "Máster"];

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

function sexFrom(...values: Array<string | null | undefined>): "M" | "F" | null {
  const value = values.map(item => String(item || "").toUpperCase()).join(" ");
  if (/(?:^|\W)(?:F|FEM|FEMENINO|FEMENINA)(?:$|\W)|U\d+F\b/.test(value)) return "F";
  if (/(?:^|\W)(?:M|MASC|MASCULINO)(?:$|\W)|U\d+M\b/.test(value)) return "M";
  return null;
}

function disciplineLabel(value: string) {
  const cleaned = value
    .replace(/\s+(?:FEM\.?|FEMENINO|FEMENINA|MASC\.?|MASCULINO)\s*/gi, " ")
    // Las actas FAM añaden a menudo la categoría al final del nombre de la
    // prueba ("60m Sub 12", "Longitud Sub 12 B"). No es otra prueba: la
    // categoría ya viaja en su propia columna y debe compartir ranking.
    .replace(/\s+(?:SUB\s*\d{1,2}|U\s*\d{1,2})(?:\s+[A-Z])?\s*$/i, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  const compact = cleaned
    .toUpperCase()
    .replace(/[._\s]/g, "")
    .replace(/MASC(?:ULINO)?|FEM(?:ENINO|ENINA)?/g, "");
  const metres = compact.match(/^(\d+)M(?:ST)?$/);
  if (metres) return `${Number(metres[1]).toLocaleString("es-ES")} m`;
  if (compact === "LONG" || /^LONGITUD/.test(compact)) return "Longitud";
  // El peso mantiene el implemento cuando existe: no es comparable un peso
  // de 2 kg con uno de 4 kg, pero sí las distintas actas del mismo peso.
  const shot = cleaned.match(/^(?:PESO|SHOT)\s*\((\d+(?:[.,]\d+)?)\s*KG\)$/i);
  if (shot) return `Peso (${shot[1].replace(",", ".")} kg)`;
  if (compact === "SHOT" || /^PESO/.test(compact)) return "Peso";
  const javelin = cleaned.match(/^(?:JABALINA|JAVELIN)\s*\((\d+)\s*G\)$/i);
  if (javelin) return `Jabalina (${javelin[1]} g)`;
  if (compact === "JAVELIN" || /^JABALINA/.test(compact)) return "Jabalina";
  return cleaned;
}

function isBetter(next: Performance, current: Performance) {
  if (next.performance_value === null) return false;
  if (current.performance_value === null) return true;
  return next.metric_type === "time" ? next.performance_value < current.performance_value : next.performance_value > current.performance_value;
}

function fromBundledResults(): Performance[] {
  return verifiedOfficialResults.map(row => ({
    id: row.id,
    athlete_name: row.athlete_name.replace(/^0\s+/, ""),
    discipline: disciplineLabel(row.event_name),
    category: categoryLabel(row.category_label),
    season: row.competition_date?.slice(0, 4) || "2025",
    metric_type: metricFromUnit(row.result_unit),
    sex: sexFrom(row.category_label, row.event_name),
    performance_value: row.result_value,
    performance_display: row.result_text,
    result_date: row.competition_date,
    competition_name: row.competition_name
  }));
}

function eventOrder(value: string) {
  const number = Number((value.match(/\d+(?:[.,]\d+)?/) || ["9999"])[0].replace(",", "."));
  const fieldBias = /(longitud|altura|peso|jabalina|disco|martillo|triple)/i.test(value) ? 10000 : 0;
  return fieldBias + number;
}

export default function HistoricalRanking() {
  // El ranking público nunca queda vacío por una caída, vista ausente o demora de Supabase.
  const bundledRows = useMemo(() => fromBundledResults(), []);
  const [rows, setRows] = useState<Performance[]>(bundledRows);
  // La portada no debe ocultar resultados con un filtro implícito. El Top 20
  // solo empieza cuando la persona elige una prueba concreta.
  const [discipline, setDiscipline] = useState("");
  const [category, setCategory] = useState("");
  const [sex, setSex] = useState<"M" | "F" | "">("");
  const [season, setSeason] = useState("");

  useEffect(() => {
    let alive = true;
    void (async () => {
      const imported: Performance[] = [];
      if (supabase) {
        const { data } = await supabase
          .from("club_event_rankings")
          .select("athlete_id,athlete_name,event_name,event_code,season,category_label,result_value,result_text,result_unit,competition_name,competition_date,ranking_position")
          .lte("ranking_position", 20);
        for (const row of (data || []) as Array<Record<string, unknown>>) {
          imported.push({
            id: `rank-${String(row.athlete_id || row.athlete_name)}-${String(row.event_code || row.event_name)}-${String(row.season)}-${String(row.category_label)}`,
            athlete_name: String(row.athlete_name || "Atleta"),
            discipline: disciplineLabel(String(row.event_name || row.event_code || "Prueba oficial")),
            category: categoryLabel(row.category_label as string | null),
            season: row.season ? String(row.season) : null,
            metric_type: metricFromUnit(row.result_unit as string | null),
            sex: sexFrom(row.category_label as string | null, row.event_name as string | null),
            performance_value: typeof row.result_value === "number" ? row.result_value : null,
            performance_display: String(row.result_text || "Resultado"),
            result_date: row.competition_date ? String(row.competition_date) : null,
            competition_name: row.competition_name ? String(row.competition_name) : null
          });
        }
      }
      if (alive && imported.length) {
        const merged = new Map<string, Performance>();
        for (const row of [...bundledRows, ...imported]) {
          merged.set(`${row.athlete_name}|${row.discipline}|${row.category || ""}|${row.sex || ""}|${row.season || ""}|${row.performance_display}`, row);
        }
        setRows([...merged.values()]);
      }
    })();
    return () => { alive = false; };
  }, [bundledRows]);

  const disciplines = useMemo(() => [...new Set(rows
    .filter(row => (!category || row.category === category) && (!sex || row.sex === sex))
    .map(row => row.discipline))]
    .sort((a, b) => eventOrder(a) - eventOrder(b) || a.localeCompare(b, "es")), [rows, category, sex]);
  const categories = useMemo(() => [...new Set([...categoryOrder, ...(rows.map(row => row.category).filter(Boolean) as string[])])], [rows]);
  const seasons = useMemo(() => [...new Set(["2026", "2025", "2024", ...(rows.map(row => row.season).filter(Boolean) as string[])])].sort().reverse(), [rows]);

  const matchingRows = useMemo(() => rows.filter(row => (!discipline || row.discipline === discipline) && (!category || row.category === category) && (!sex || row.sex === sex) && (!season || row.season === season)), [rows, discipline, category, sex, season]);

  const displayedRows = useMemo(() => {
    // Sin prueba seleccionada se muestra el archivo completo: es una consulta,
    // no un ranking. Conservamos cada resultado y lo ordenamos por fecha.
    if (!discipline) return [...matchingRows]
      .sort((left, right) => (right.result_date || "").localeCompare(left.result_date || "") || left.discipline.localeCompare(right.discipline, "es") || left.athlete_name.localeCompare(right.athlete_name, "es"));

    // Con una prueba sí se convierte en ranking: mejor marca por atleta y Top 20.
    const bestByAthlete = new Map<string, Performance>();
    for (const row of matchingRows) {
      const key = row.athlete_name + "|" + row.discipline + "|" + (row.category || "") + "|" + (row.sex || "") + "|" + (row.season || "");
      const current = bestByAthlete.get(key);
      if (!current || isBetter(row, current)) bestByAthlete.set(key, row);
    }
    return [...bestByAthlete.values()].sort((left, right) => {
      if (left.performance_value === null) return 1;
      if (right.performance_value === null) return -1;
      return left.metric_type === "time" ? left.performance_value - right.performance_value : right.performance_value - left.performance_value;
    }).slice(0, 20);
  }, [matchingRows, discipline]);

  return <section>
    <div className="page-head"><div><h1>Ranking histórico del club</h1><p>{discipline ? "Top 20 por prueba, categoría y temporada; cada atleta figura con su mejor marca oficial verificada." : "Todos los resultados oficiales encontrados. Elige una prueba para ver su Top 20 histórico."}</p></div></div>
    <article className="panel inline-form">
      <label>Categoría<select value={category} onChange={event => { const next = event.target.value; setCategory(next); const valid = rows.filter(row => (!next || row.category === next) && (!sex || row.sex === sex)).map(row => row.discipline); if (discipline && !valid.includes(discipline)) setDiscipline(valid.sort((a, b) => eventOrder(a) - eventOrder(b))[0] || ""); }}><option value="">Todas las categorías</option>{categories.map(value => <option value={value} key={value}>{value}</option>)}</select></label>
      <label>Sexo<select value={sex} onChange={event => { const next = event.target.value as "M" | "F" | ""; setSex(next); const valid = rows.filter(row => (!category || row.category === category) && (!next || row.sex === next)).map(row => row.discipline); if (discipline && !valid.includes(discipline)) setDiscipline(valid.sort((a, b) => eventOrder(a) - eventOrder(b))[0] || ""); }}><option value="">Masculino y femenino</option><option value="M">Masculino</option><option value="F">Femenino</option></select></label>
      <label>Prueba<select value={discipline} onChange={event => setDiscipline(event.target.value)}><option value="">Todas las pruebas</option>{disciplines.map(value => <option value={value} key={value}>{value}</option>)}</select></label>
      <label>Temporada<select value={season} onChange={event => setSeason(event.target.value)}><option value="">Todas las temporadas</option>{seasons.map(value => <option value={value} key={value}>{value}</option>)}</select></label>
    </article>
    <article className="panel table historical-top">{displayedRows.map((row, index) => <div className={"row historical-rank " + (discipline && index < 8 ? "top-eight" : "")} key={row.id}>
      <span><b>{discipline ? `${index < 8 ? "★ " : "#"}${index + 1} · ` : ""}{row.athlete_name}</b><small>{row.discipline} · {row.category || "Categoría sin indicar"} · {row.sex === "M" ? "Masculino" : row.sex === "F" ? "Femenino" : "Sexo sin indicar"} · {row.season || "Temporada"}</small></span>
      <span><b>{row.performance_display}</b><small>{discipline ? (index < 8 ? "TOP 8 HISTÓRICO" : "Top 20 histórico") : "Resultado oficial"}</small></span>
      <span>{row.competition_name || "Resultado oficial"}<small>{row.result_date ? new Date(row.result_date + "T00:00:00").toLocaleDateString("es-ES") : ""}</small></span>
    </div>)}{!displayedRows.length && <div className="empty">Aún no hay resultados oficiales verificados para este filtro.</div>}</article>
  </section>;
}
