import { useMemo, useState } from "react";

type Run = { id:string; started_at:string; distance_m:number|null; moving_time_s:number|null; activity_type:string|null };
const runningTypes=new Set(["run","trailrun","virtualrun","wheelchair"]);
const pace=(secondsPerKm:number)=>{const total=Math.max(0,Math.round(secondsPerKm));return `${Math.floor(total/60)}:${String(total%60).padStart(2,"0")}/km`};
const clock=(seconds:number)=>{const total=Math.max(0,Math.round(seconds)),hours=Math.floor(total/3600),minutes=Math.floor((total%3600)/60),secs=total%60;return hours?`${hours}:${String(minutes).padStart(2,"0")}:${String(secs).padStart(2,"0")}`:`${minutes}:${String(secs).padStart(2,"0")}`};
const split=(secondsPerKm:number,metres:number)=>clock(secondsPerKm*metres/1000);

export default function RunningPaceLab({activities}:{activities:Run[]}){
 const [mode,setMode]=useState<"prediction"|"goal">("prediction");
 const [goalDistance,setGoalDistance]=useState("42.195"),[goalTime,setGoalTime]=useState("3:15:00");
 const model=useMemo(()=>{
  const runs=activities.filter(a=>runningTypes.has(String(a.activity_type||"").toLowerCase())&&(a.distance_m||0)>=3000&&(a.moving_time_s||0)>0);
  const samples=runs.map(a=>({distance:(a.distance_m||0)/1000,time:a.moving_time_s||0,pace:(a.moving_time_s||0)/((a.distance_m||1)/1000)})).filter(a=>a.pace>150&&a.pace<900);
  const equivalents=samples.map(a=>a.time*Math.pow(5/a.distance,1.06)).sort((a,b)=>a-b);
  const reference=equivalents.length?equivalents[Math.min(equivalents.length-1,Math.floor(equivalents.length*.2))]:0;
  const recent=runs.filter(a=>Date.now()-new Date(a.started_at).getTime()<42*86400000);
  const weeklyKm=recent.reduce((sum,a)=>sum+(a.distance_m||0)/1000,0)/6;
  const longest=Math.max(0,...recent.map(a=>(a.distance_m||0)/1000));
  const predict=(distance:number)=>reference*Math.pow(distance/5,1.06)*(distance===21.0975?1+Math.max(0,18-longest)*.003:distance>40?1+Math.max(0,28-longest)*.008+Math.max(0,35-weeklyKm)*.004:1);
  const ten=reference?predict(10):0,half=reference?predict(21.0975):0,marathon=reference?predict(42.195):0;
  const tenPace=ten/10;
  const confidence=samples.length>=8&&longest>=18?"media/alta":samples.length>=3?"media":"inicial";
  return {samples:samples.length,weeklyKm,longest,ten,half,marathon,tenPace,confidence};
 },[activities]);
 const parseGoal=()=>{const parts=goalTime.split(":").map(Number);if(parts.some(Number.isNaN))return 0;return parts.length===3?parts[0]*3600+parts[1]*60+parts[2]:parts[0]*60+parts[1]};
 const goalPace=parseGoal()/Math.max(.1,Number(goalDistance)||0);
 const goalTenSeconds=parseGoal()&&Number(goalDistance)>0?parseGoal()/Math.pow(Number(goalDistance)/10,1.06):0;
 const base=mode==="goal"&&goalTenSeconds?goalTenSeconds/10:model.tenPace;
  const bands=base?[{name:"Rodaje de recuperación",range:[base*1.32,base*1.46],use:"Después de carga o competición"},{name:"Rodaje cómodo",range:[base*1.2,base*1.33],use:"Base aeróbica y conversación fácil"},{name:"Rodaje largo",range:[base*1.16,base*1.28],use:"Resistencia; empezar por la parte lenta"},{name:"Rodaje progresivo",range:[base*1.18,base*1.06],use:"De cómodo a sostenido, sin terminar al máximo"},{name:"Umbral / tempo",range:[base*.98,base*1.05],use:"Bloques continuos o fraccionados"},{name:"Series largas 1.200–3.000 m",range:[base*.96,base*1.03],use:"Resistencia específica y control del umbral"},{name:"Intervalos 600–1.000 m",range:[base*.9,base*.97],use:"Trabajo aeróbico intenso"},{name:"Repeticiones 200–400 m",range:[base*.82,base*.91],use:"Técnica, economía y velocidad controlada"}]:[];
 return <article className="pace-lab">
  <header><div><small>RITMOS Y PRONÓSTICO</small><h3>Laboratorio de carrera</h3><p>Convierte los datos reales en predicciones y zonas individualizadas.</p></div><span className="pace-confidence">Confianza {model.confidence}</span></header>
  <nav><button type="button" className={mode==="prediction"?"selected":""} onClick={()=>setMode("prediction")}>Según mi estado actual</button><button type="button" className={mode==="goal"?"selected":""} onClick={()=>setMode("goal")}>Simular un objetivo</button></nav>
  {mode==="prediction"?<>
   <div className="race-predictions"><article><small>10 KM</small><b>{model.ten?clock(model.ten):"—"}</b><span>{model.ten?pace(model.ten/10):"Faltan carreras"}</span></article><article><small>MEDIA MARATÓN</small><b>{model.half?clock(model.half):"—"}</b><span>{model.half?pace(model.half/21.0975):"Faltan datos"}</span></article><article><small>MARATÓN</small><b>{model.marathon?clock(model.marathon):"—"}</b><span>{model.marathon?pace(model.marathon/42.195):"Faltan datos"}</span></article></div>
   <p className="pace-context">Referencia: {model.samples} carreras útiles · {model.weeklyKm.toFixed(1)} km/semana recientes · tirada más larga {model.longest.toFixed(1)} km. La media y la maratón se corrigen por volumen y resistencia disponible.</p>
  </>:<div className="goal-calculator"><label>Distancia objetivo (km)<input inputMode="decimal" value={goalDistance} onChange={e=>setGoalDistance(e.target.value.replace(",","."))}/></label><label>Tiempo objetivo (h:mm:ss)<input value={goalTime} onChange={e=>setGoalTime(e.target.value)}/></label><article><small>Ritmo de competición</small><b>{goalPace?pace(goalPace):"—"}</b></article></div>}
  {bands.length?<div className="training-bands">{bands.map(item=><article key={item.name}><div><small>{item.name}</small><b>{pace(item.range[0])} – {pace(item.range[1])}</b><span>{item.use}</span></div>{item.name.includes("200")&&<em>200 m: {split(item.range[0],200)}–{split(item.range[1],200)} · 400 m: {split(item.range[0],400)}–{split(item.range[1],400)}</em>}{item.name.includes("600")&&<em>800 m: {split(item.range[0],800)}–{split(item.range[1],800)} · 1.000 m: {split(item.range[0],1000)}–{split(item.range[1],1000)}</em>}{item.name.includes("1.200")&&<em>1.200 m: {split(item.range[0],1200)}–{split(item.range[1],1200)} · 2.000 m: {split(item.range[0],2000)}–{split(item.range[1],2000)} · 3.000 m: {split(item.range[0],3000)}–{split(item.range[1],3000)}</em>}</article>)}</div>:<p className="pace-empty">Necesitamos al menos una carrera de 3 km o más con tiempo y distancia para iniciar el cálculo.</p>}
  <footer>Orientación deportiva: el entrenador valida el ritmo final según terreno, clima, recuperación, objetivo y sensaciones. No sustituye una valoración médica.</footer>
 </article>
}
