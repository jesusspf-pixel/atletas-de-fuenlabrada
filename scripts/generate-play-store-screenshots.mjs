import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const output = path.join(root, "mobile/play-store-assets/screenshots");
await fs.mkdir(output, { recursive: true });
const icon = (await fs.readFile(path.join(root, "public/app-icon-512.png"))).toString("base64");

const colors = { bg: "#071426", panel: "#10243d", panel2: "#15304f", blue: "#2d7ff9", pink: "#ec168c", white: "#f7fbff", muted: "#9fb2c8", line: "#284563", green: "#43d39e", amber: "#ffc857" };
const esc = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const text = (x, y, value, size = 34, fill = colors.white, weight = 500, anchor = "start") => `<text x="${x}" y="${y}" fill="${fill}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" font-family="Inter,Arial,sans-serif">${esc(value)}</text>`;
const rect = (x, y, w, h, fill = colors.panel, radius = 28, stroke = "none") => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`;
const pill = (x, y, w, label, fill = colors.panel2, color = colors.white) => `${rect(x, y, w, 56, fill, 28)}${text(x + w / 2, y + 38, label, 24, color, 700, "middle")}`;
const progress = (x, y, w, value, color = colors.blue) => `${rect(x, y, w, 16, "#1f3a57", 8)}${rect(x, y, Math.round(w * value), 16, color, 8)}`;
const nav = (active) => {
  const items = [["Inicio", 150], ["Planes", 410], ["Challenge", 670], ["Perfil", 930]];
  return `<g>${rect(54, 1748, 972, 120, "#0b1b2e", 38, colors.line)}${items.map(([label, x]) => `${label === active ? `<circle cx="${x}" cy="1792" r="10" fill="${colors.pink}"/>` : `<circle cx="${x}" cy="1792" r="8" fill="${colors.muted}"/>`}${text(x, 1838, label, 23, label === active ? colors.white : colors.muted, label === active ? 700 : 500, "middle")}`).join("")}</g>`;
};
const frame = (title, subtitle, body, active = "Inicio") => `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#061223"/><stop offset="1" stop-color="#102d4b"/></linearGradient><filter id="shadow"><feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#000" flood-opacity=".28"/></filter></defs>
  <rect width="1080" height="1920" fill="url(#bg)"/>
  <circle cx="972" cy="120" r="260" fill="#1768d5" opacity=".16"/><circle cx="80" cy="520" r="220" fill="#ec168c" opacity=".08"/>
  <image href="data:image/png;base64,${icon}" x="62" y="64" width="104" height="104"/>
  ${text(190, 108, "ATLETAS", 34, colors.white, 800)}${text(190, 146, "DE FUENLABRADA", 25, colors.muted, 700)}
  ${pill(828, 76, 190, "DEMO SEGURA", "#16385b", colors.green)}
  ${text(62, 252, title, 56, colors.white, 800)}${text(62, 304, subtitle, 28, colors.muted, 500)}
  ${body}${nav(active)}
</svg>`;

const screens = [
  ["01-inicio-familia.png", frame("Tu semana, siempre clara", "Familia y atleta · Running A", `
    ${rect(54, 370, 972, 230, colors.panel, 34, colors.line)}${text(90, 426, "PRÓXIMO ENTRENAMIENTO", 22, colors.pink, 800)}${text(90, 488, "Rodaje suave · 35 minutos", 38, colors.white, 750)}${pill(90, 520, 190, "HOY · 18:00", colors.blue)}${pill(300, 520, 220, "Pista central")}
    ${text(62, 690, "Esta semana", 34, colors.white, 750)}
    ${[["LUN", "Rodaje suave", "35 min"], ["MAR", "Técnica + 6 × 400", "55 min"], ["JUE", "Rodaje progresivo", "40 min"], ["SÁB", "Sesión en grupo", "50 min"]].map((r, i) => `${rect(54, 730 + i * 142, 972, 116, i === 0 ? colors.panel2 : colors.panel, 26, i === 0 ? colors.blue : colors.line)}${pill(78, 760 + i * 142, 90, r[0], i === 0 ? colors.blue : "#1c3855")}${text(198, 782 + i * 142, r[1], 30, colors.white, 650)}${text(930, 782 + i * 142, r[2], 26, colors.muted, 600, "end")}`).join("")}
    ${rect(54, 1336, 972, 286, "#10283d", 34, colors.green)}${text(90, 1396, "AVISO DEL CLUB", 22, colors.green, 800)}${text(90, 1454, "Cambio de ubicación", 36, colors.white, 750)}${text(90, 1504, "El entrenamiento de hoy será en el", 28, colors.muted)}${text(90, 1544, "circuito de cross de la Universidad.", 28, colors.muted)}${pill(90, 1566, 258, "Ver ubicación", "#174c3b", colors.green)}
  `, "Inicio")],
  ["02-plan-semanal.png", frame("Plan semanal publicado", "Running A · Del 7 al 13 de septiembre", `
    ${rect(54, 360, 972, 96, colors.panel2, 30, colors.blue)}${text(90, 420, "4 sesiones · 180 minutos · Adaptado al grupo", 27, colors.white, 650)}
    ${[["LUNES", "Rodaje suave", "35 min · Z1–Z2", colors.blue], ["MARTES", "Técnica + 6 × 400 m", "55 min · Z3", colors.pink], ["MIÉRCOLES", "Descanso", "Movilidad opcional", colors.green], ["JUEVES", "Rodaje progresivo", "40 min · Z2–Z3", colors.amber], ["VIERNES", "Fuerza y movilidad", "30 min", colors.green], ["SÁBADO", "Sesión en grupo", "50 min · Z2", colors.blue], ["DOMINGO", "Descanso", "Recuperación", colors.green]].map((r, i) => `${rect(54, 492 + i * 164, 972, 136, colors.panel, 28, colors.line)}<rect x="54" y="492" width="10" height="136" rx="5" fill="${r[3]}" transform="translate(0 ${i * 164})"/>${text(90, 538 + i * 164, r[0], 21, r[3], 800)}${text(90, 585 + i * 164, r[1], 31, colors.white, 700)}${text(946, 585 + i * 164, r[2], 25, colors.muted, 600, "end")}`).join("")}
  `, "Planes")],
  ["03-club-challenge.png", frame("Club Challenge", "Superarnos juntos, cada uno a su ritmo", `
    ${rect(54, 362, 972, 300, "#122a43", 38, colors.pink)}${text(90, 420, "RETO COLECTIVO", 22, colors.pink, 800)}${text(90, 482, "Fuenlabrada suma 500 km", 38, colors.white, 780)}${text(90, 538, "312 km completados", 30, colors.green, 700)}${text(946, 538, "62 %", 30, colors.white, 800, "end")}${progress(90, 574, 856, .624, colors.pink)}${text(90, 626, "188 km para conseguirlo juntos", 25, colors.muted)}
    ${text(62, 748, "Clasificación semanal", 34, colors.white, 750)}
    ${[["1", "Cris Demo", "42 km", colors.amber], ["2", "Álex Demo", "38 km", colors.blue], ["3", "Mar Demo", "31 km", colors.pink], ["4", "Dani Demo", "27 km", colors.green]].map((r, i) => `${rect(54, 792 + i * 144, 972, 118, colors.panel, 28, i === 0 ? colors.amber : colors.line)}<circle cx="116" cy="${851 + i * 144}" r="36" fill="${r[3]}" opacity=".22"/>${text(116, 862 + i * 144, r[0], 28, r[3], 850, "middle")}${text(182, 862 + i * 144, r[1], 31, colors.white, 700)}${text(946, 862 + i * 144, r[2], 30, r[3], 800, "end")}`).join("")}
    ${rect(54, 1410, 972, 210, colors.panel2, 30, colors.line)}${text(90, 1468, "TU PROGRESO", 22, colors.green, 800)}${text(90, 1524, "5 días de constancia", 36, colors.white, 750)}${progress(90, 1560, 856, .72, colors.green)}
  `, "Challenge")],
  ["04-panel-entrenador.png", frame("Todo listo para entrenar", "Panel del entrenador · Running A", `
    ${[["6", "Atletas"], ["4", "Sesiones"], ["83 %", "Asistencia"]].map((r, i) => `${rect(54 + i * 328, 364, 300, 180, colors.panel, 28, colors.line)}${text(84 + i * 328, 440, r[0], 44, colors.white, 800)}${text(84 + i * 328, 492, r[1], 25, colors.muted, 600)}`).join("")}
    ${rect(54, 590, 972, 300, colors.panel2, 34, colors.blue)}${text(90, 648, "PRÓXIMA SESIÓN", 22, colors.blue, 800)}${text(90, 708, "Rodaje suave · 35 minutos", 38, colors.white, 760)}${text(90, 760, "Hoy · 18:00 · Pista central", 28, colors.muted)}${pill(90, 800, 250, "Abrir planificación", colors.blue)}${pill(362, 800, 210, "Pasar lista", "#174c3b", colors.green)}
    ${text(62, 978, "Asistencia de hoy", 34, colors.white, 750)}
    ${[["Álex Demo", true], ["Cris Demo", true], ["Dani Demo", true], ["Mar Demo", false], ["Sam Demo", true], ["Vega Demo", false]].map((r, i) => `${rect(54, 1020 + i * 104, 972, 82, colors.panel, 22, colors.line)}<circle cx="102" cy="1061" r="20" fill="${r[1] ? colors.green : "#39516a"}"/>${r[1] ? `<path d="M92 ${1061 + i * 104}l7 8 14-17" fill="none" stroke="#071426" stroke-width="5" stroke-linecap="round"/>` : ""}${text(146, 1072 + i * 104, r[0], 28, colors.white, 650)}${text(946, 1072 + i * 104, r[1] ? "Presente" : "Pendiente", 24, r[1] ? colors.green : colors.muted, 650, "end")}`).join("")}
  `, "Inicio")]
];

for (const [filename, svg] of screens) {
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(path.join(output, filename));
}
console.log(`Generated ${screens.length} screenshots in ${output}`);
