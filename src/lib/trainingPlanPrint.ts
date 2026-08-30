const WEEK_DAYS =
  "LUNES|MARTES|MIÉRCOLES|JUEVES|VIERNES|SÁBADO|DOMINGO";

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[character] || character,
  );

const titleCase = (value: string) =>
  value.charAt(0).toUpperCase() + value.slice(1).toLocaleLowerCase("es-ES");

const formatWeek = (week: string) => {
  const start = new Date(`${week}T12:00:00`);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const startText = start.toLocaleDateString("es-ES", {
    day: "numeric",
    month: "long",
  });
  const endText = end.toLocaleDateString("es-ES", {
    day: "numeric",
    month: start.getMonth() === end.getMonth() ? undefined : "long",
  });
  return `${startText} - ${endText}`;
};

const parseSessions = (body: string) =>
  body
    .replace(/\r/g, "")
    .split(new RegExp(`\\n\\s*\\n(?=(?:${WEEK_DAYS})\\n)`, "i"))
    .map((block) => {
      const lines = block
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      const day = lines.shift() || "";
      if (!new RegExp(`^(?:${WEEK_DAYS})$`, "i").test(day)) return null;
      const load = lines.shift() || "";
      const details = lines.map((line) => {
        const separator = line.indexOf(":");
        return {
          label: separator > 0 ? line.slice(0, separator).trim() : "Detalle",
          value: separator > 0 ? line.slice(separator + 1).trim() : line,
        };
      });
      return { day, load, details };
    })
    .filter(Boolean) as {
    day: string;
    load: string;
    details: { label: string; value: string }[];
  }[];

export function printTrainingPlan(
  title: string,
  body: string,
  week: string,
  groupName: string,
) {
  const sessions = parseSessions(body);
  const sessionCards = sessions
    .map(
      (session, index) => `
        <article class="session${sessions.length === 5 && index === 4 ? " wide" : ""}">
          <header class="session-head">
            <div><small>SESIÓN</small><h2>${escapeHtml(titleCase(session.day))}</h2></div>
            ${session.load ? `<span>${escapeHtml(session.load)}</span>` : ""}
          </header>
          <div class="details">
            ${session.details
              .map(
                (detail) => `<section class="detail">
                  <strong>${escapeHtml(detail.label)}</strong>
                  <p>${escapeHtml(detail.value)}</p>
                </section>`,
              )
              .join("")}
          </div>
        </article>`,
    )
    .join("");
  const popup = window.open("", "_blank", "width=1000,height=900");
  if (!popup) return false;
  popup.document.write(`<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <base href="${window.location.origin}/">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    @page{size:A4 portrait;margin:8mm}
    *{box-sizing:border-box}
    html,body{margin:0;padding:0;background:#edf4fb;color:#0a274f;font-family:Arial,Helvetica,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    body{min-height:100vh;padding:0;line-height:1.28}
    .page{width:100%;min-height:calc(297mm - 16mm);display:flex;flex-direction:column;gap:3.2mm}
    .plan-head{height:42mm;position:relative;overflow:hidden;border-radius:6mm;background:linear-gradient(135deg,#071d3d 0%,#0c4da2 70%,#237bda 100%);color:#fff;padding:6mm 7mm}
    .plan-head:before{content:"";position:absolute;width:48mm;height:48mm;border:5mm solid rgba(255,255,255,.1);border-radius:50%;right:-17mm;top:-26mm}
    .brand{display:flex;align-items:center;gap:3mm;color:#c9e3ff;font-size:8pt;font-weight:800;letter-spacing:.13em}
    .brand img{width:15mm;height:15mm;object-fit:contain}
    .headline{position:absolute;left:7mm;right:7mm;bottom:6mm;display:flex;justify-content:space-between;align-items:flex-end;gap:8mm}
    h1{margin:0;font-size:22pt;line-height:1;letter-spacing:-.04em}
    .meta{text-align:right}.meta b{display:block;color:#b8ff32;font-size:10pt;text-transform:uppercase}.meta span{display:block;margin-top:1.5mm;color:#fff;font-size:8pt}
    .sessions{flex:1;min-height:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));grid-template-rows:repeat(3,minmax(0,1fr));gap:3mm}
    .session{min-width:0;min-height:0;overflow:hidden;background:#fff;border:.3mm solid #d8e6f4;border-radius:4mm;box-shadow:0 1.5mm 4mm rgba(12,56,106,.07)}
    .session.wide{grid-column:1/-1}.session.wide .details{grid-template-columns:repeat(2,minmax(0,1fr))}
    .session-head{min-height:11mm;display:flex;align-items:center;justify-content:space-between;gap:3mm;padding:2.4mm 3.4mm;background:#eaf3fc}
    .session-head small{display:block;color:#0c58b6;font-size:5.4pt;font-weight:800;letter-spacing:.13em}.session-head h2{margin:.5mm 0 0;font-size:13pt;line-height:1}
    .session-head span{max-width:58%;text-align:right;color:#0c58b6;font-size:6.2pt;font-weight:800;line-height:1.25}
    .details{display:grid;grid-template-columns:1fr;gap:1.7mm;padding:2.7mm 3.4mm}
    .detail{min-width:0;border-left:.8mm solid #2c8beb;padding-left:2mm}
    .detail strong{display:block;color:#0c58b6;font-size:5.5pt;line-height:1;text-transform:uppercase;letter-spacing:.06em}
    .detail p{margin:.8mm 0 0;color:#173858;font-size:6.7pt;line-height:1.28;overflow-wrap:anywhere}
    .fallback{grid-column:1/-1;grid-row:1/-1;white-space:pre-wrap;background:#fff;border:.3mm solid #d8e6f4;border-radius:4mm;padding:6mm;font-size:9pt}
    .plan-foot{height:6mm;display:flex;justify-content:space-between;align-items:center;color:#627895;font-size:6.2pt;padding:0 1mm}
    @media screen{body{padding:18px}.page{max-width:794px;margin:auto;background:#edf4fb;padding:20px;border-radius:24px;box-shadow:0 20px 60px rgba(7,29,61,.16)}}
    @media print{body{background:#fff}.page{gap:3.2mm}.session{box-shadow:none}}
  </style>
</head>
<body>
  <main class="page">
    <header class="plan-head">
      <div class="brand"><img src="/logo-af-v1.png" alt=""><span>CLUB ATLETAS DE FUENLABRADA</span></div>
      <div class="headline">
        <h1>PLAN SEMANAL</h1>
        <div class="meta"><b>${escapeHtml(groupName)}</b><span>Semana ${escapeHtml(formatWeek(week))}</span></div>
      </div>
    </header>
    <section class="sessions">${sessionCards || `<article class="fallback">${escapeHtml(body)}</article>`}</section>
    <footer class="plan-foot"><span>Club Atletas de Fuenlabrada · atletasdefuenlabrada.com</span><span>Sigue las indicaciones de tu entrenador</span></footer>
  </main>
  <script>window.addEventListener("load",()=>setTimeout(()=>window.print(),250));<\/script>
</body>
</html>`);
  popup.document.close();
  return true;
}
