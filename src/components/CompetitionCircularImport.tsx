import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { apiFetch } from '../lib/clubApi';
export type CircularTest = {name:string;categories:string[];sex:'all'|'female'|'male';minYear:number|null;maxYear:number|null;notes:string;evidence:string};
const categories=['Sub 8','Sub 10','Sub 12','Sub 14','Sub 16','Sub 18','Sub 20','Sub 23'];
export function CompetitionCircularImport({file,onReview}:{file:File;onReview:(tests:CircularTest[],reviewed:boolean)=>void}) {
  const [tests,setTests]=useState<CircularTest[]>([]);
  const [warnings,setWarnings]=useState<string[]>([]);
  const [error,setError]=useState('');
  const [reading,setReading]=useState(true);
  const [reviewed,setReviewed]=useState(false);
  const [attempt,setAttempt]=useState(0);
  useEffect(()=>{
    const controller=new AbortController(); let cancelled=false;
    setReading(true);setReviewed(false);setTests([]);setWarnings([]);setError('');onReview([],false);
    void (async()=>{
      try {
        if(file.size>2_000_000) throw new Error('Lectura automática: máximo 2 MB. Puedes preparar las pruebas manualmente y conservar este PDF.');
        const bytes=new Uint8Array(await file.arrayBuffer());let binary='';
        for(let i=0;i<bytes.length;i+=8192) binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
        const session=await supabase?.auth.getSession();const token=session?.data.session?.access_token;
        if(!token) throw new Error('Inicia sesión de nuevo.');
        const response=await apiFetch('/api/competition-circular',{method:'POST',signal:controller.signal,headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({data:btoa(binary)})});
        const result=await response.json();
        if(!response.ok) throw new Error(result.error||'No se pudo leer la circular.');
        if(!cancelled){setTests(result.tests);setWarnings(result.warnings);onReview(result.tests,false);}
      } catch(e){if(!cancelled)setError(e instanceof Error?e.message:'No se pudo leer el PDF.');}
      finally {if(!cancelled)setReading(false);}
    })();
    return ()=>{cancelled=true;controller.abort();};
    // The selected file or an explicit retry starts a new extraction, not each parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[file,attempt]);
  const change=(next:CircularTest[])=>{setTests(next);setReviewed(false);onReview(next,false);};
  const valid=tests.length>0&&tests.every(t=>t.name.trim()&&t.categories.length&&t.categories.every(c=>categories.includes(c))&&(t.minYear===null||Number.isInteger(t.minYear))&&(t.maxYear===null||Number.isInteger(t.maxYear))&&(t.minYear===null||t.maxYear===null||t.minYear<=t.maxYear))&&new Set(tests.map(t=>t.name.trim().toLowerCase()+'|'+t.sex)).size===tests.length;
  const edit=(i:number,patch:Partial<CircularTest>)=>change(tests.map((t,n)=>n===i?{...t,...patch}:t));
  return <section className="panel"><h3>Pruebas de la circular</h3>
    <p>El PDF quedará disponible para las familias. Revisa estas pruebas antes de publicar: cada hijo verá solo las compatibles con su nacimiento y sexo.</p>
    {reading&&<p role="status">Leyendo la circular y preparando las pruebas…</p>}
    {error&&<p role="alert">{error}</p>}
    {warnings.length>0&&<div role="alert"><strong>Revisar en la circular</strong><ul>{warnings.map((w,i)=><li key={i}>{w}</li>)}</ul></div>}
    {tests.map((t,i)=><fieldset key={i} disabled={reading}><legend>Prueba {i+1}</legend><div className="form-grid">
      <label>Nombre de prueba<input value={t.name} onChange={e=>edit(i,{name:e.target.value})}/></label>
      <fieldset><legend>Categorías</legend>{categories.map(category=><label className="check-line" key={category}><input type="checkbox" checked={t.categories.includes(category)} onChange={e=>edit(i,{categories:e.target.checked?[...t.categories,category]:t.categories.filter(c=>c!==category)})}/>{category}</label>)}</fieldset>
      <label>Sexo<select value={t.sex} onChange={e=>edit(i,{sex:e.target.value as CircularTest['sex']})}><option value="all">Todos</option><option value="female">Femenino</option><option value="male">Masculino</option></select></label>
      <label>Año de nacimiento desde<input type="number" min="1900" max="2200" value={t.minYear??''} onChange={e=>edit(i,{minYear:e.target.value?Number(e.target.value):null})}/></label>
      <label>Año de nacimiento hasta<input type="number" min="1900" max="2200" value={t.maxYear??''} onChange={e=>edit(i,{maxYear:e.target.value?Number(e.target.value):null})}/></label>
      <label>Indicaciones<input value={t.notes} onChange={e=>edit(i,{notes:e.target.value})}/></label></div>
      {t.evidence&&<p>Referencia del PDF: {t.evidence}</p>}<button type="button" onClick={()=>change(tests.filter((_,n)=>n!==i))}>Quitar prueba {i+1}</button>
    </fieldset>)}
    {!reading&&<><button type="button" onClick={()=>change([...tests,{name:'',categories:[],sex:'all',minYear:null,maxYear:null,notes:'',evidence:''}])}>Añadir prueba al borrador</button><button type="button" onClick={()=>setAttempt(a=>a+1)}>Volver a leer el PDF</button></>}
    {!reading&&!valid&&<p>Completa al menos una prueba con categoría válida, años coherentes y nombre único por sexo. Categorías: {categories.join(', ')}.</p>}
    <label className="check-line"><input type="checkbox" disabled={reading||!valid} checked={reviewed} onChange={e=>{setReviewed(e.target.checked);onReview(tests,e.target.checked);}}/>He contrastado todas las pruebas, años, categorías y avisos con la circular.</label>
  </section>;
}
