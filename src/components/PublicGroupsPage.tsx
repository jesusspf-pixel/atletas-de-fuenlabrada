import "./public-groups-page.css";

type Props={onBack:()=>void;onSignup:()=>void};
const rows=[
 ["Sub-6","Lunes y miércoles o martes y jueves","17:00–18:00","45 €","Sin licencia federativa"],
 ["Sub-8","Lunes y miércoles o martes y jueves","17:00–18:00","65 €","Licencia FAM incluida"],
 ["Sub-10","Lunes y miércoles o martes y jueves","17:00–18:00","65 €","Licencia FAM incluida"],
 ["Sub-12","Lunes y miércoles o martes y jueves","18:00–19:00","65 €","Licencia FAM incluida"],
 ["Sub-14","Lunes a jueves","19:00–21:00","65 €","Licencia FAM incluida"],
 ["Sub-16","Lunes a jueves","19:00–21:00","65 €","Licencia FAM incluida"],
 ["Sub-18","Lunes a jueves","19:00–21:00","75 €","Licencia FAM incluida"],
 ["Sub-20","Lunes a jueves","19:00–21:00","75 €","Licencia FAM incluida"],
 ["Sub-23","Lunes a jueves","19:00–21:00","95 €","Licencia FAM incluida"],
 ["Absoluto","Lunes a jueves","19:00–21:00","95 €","Licencia FAM incluida"],
];
export default function PublicGroupsPage({onBack,onSignup}:Props){return <main className="groups-page">
<header className="groups-top"><button onClick={onBack}>← Club Atletas de Fuenlabrada</button><button className="groups-signup" onClick={onSignup}>Quiero inscribirme</button></header>
<section className="groups-hero"><small>TEMPORADA 2026 / 27</small><h1>Grupos, horarios<br/>y precios.</h1><p>Toda la información para elegir tu grupo antes de iniciar la inscripción.</p><div><span><b>35 €</b> / mes</span><span><b>70 €</b> / trimestre</span></div></section>
<section className="groups-list"><div className="groups-intro"><small>ESCUELA Y COMPETICIÓN</small><h2>Desde los 4 años hasta Absoluto.</h2><p>La cuota de entrenamiento es la misma en todas las categorías, independientemente del número de días asignados al grupo. Las matrículas indicadas corresponden a altas nuevas de la temporada 2026/27.</p></div><div className="groups-grid">{rows.map(([cat,days,hours,fee,license])=><article key={cat}><div className="groups-card-head"><div><small>CATEGORÍA</small><h3>{cat}</h3></div><span className={license.includes("incluida")?"license yes":"license"}>{license}</span></div><div className="schedule"><span><small>DÍAS</small><b>{days}</b></span><span><small>HORARIO</small><b>{hours}</b></span></div><div className="prices"><span><small>MATRÍCULA ALTA NUEVA</small><b>{fee}</b></span><span><small>CUOTA MENSUAL</small><b>35 €</b></span><span className="best"><small>CUOTA TRIMESTRAL</small><b>70 €</b></span></div><button onClick={onSignup}>Inscribirme en {cat}</button></article>)}</div></section>
<section className="master-block"><div><small>RUNNING · MÁSTER</small><h2>Entrena cuatro días por semana.</h2><p>Lunes a jueves · 19:30–20:30</p></div><div className="master-options"><article><small>MÁSTER CON LICENCIA</small><b>95 €</b><span>Matrícula de alta nueva · licencia FAM incluida</span><p><strong>35 €/mes</strong> · 70 €/trimestre</p></article><article><small>MÁSTER RUNNING SIN LICENCIA</small><b>45 €</b><span>Matrícula de alta nueva · sin licencia federativa</span><p><strong>35 €/mes</strong> · 70 €/trimestre</p></article></div><button className="master-cta" onClick={onSignup}>Quiero entrenar con el club</button></section>
<section className="groups-license"><b>Sobre la licencia federativa</b><p>La matrícula incluye licencia de la Federación de Atletismo de Madrid desde Sub-8 hasta Absoluto. Sub-6 no dispone de licencia federativa. En Máster puedes elegir modalidad con licencia o Running sin licencia.</p></section>
<footer className="groups-footer"><button onClick={onBack}>← Volver a la web del club</button><button onClick={onSignup}>Iniciar inscripción</button></footer>
</main>}
