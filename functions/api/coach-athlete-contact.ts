type Env={SUPABASE_URL?:string;SUPABASE_SERVICE_ROLE_KEY?:string};
type Contact={name:string;relationship:string;phone:string};
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{"cache-control":"no-store"}});
const rows=async<T>(url:string,headers:Record<string,string>)=>{const response=await fetch(url,{headers});return response.ok?await response.json() as T[]:[]};

export const onRequestGet:PagesFunction<Env>=async({request,env})=>{
  if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)return json({error:"Configuración incompleta."},503);
  const authorization=request.headers.get("authorization")||"";
  if(!authorization.startsWith("Bearer "))return json({error:"Inicia sesión de nuevo."},401);
  const auth=await fetch(`${env.SUPABASE_URL}/auth/v1/user`,{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization}});
  const user=await auth.json().catch(()=>null) as {id?:string}|null;
  if(!auth.ok||!user?.id)return json({error:"La sesión ha caducado."},401);
  const athleteId=new URL(request.url).searchParams.get("athleteId")||"";
  if(!athleteId)return json({error:"Falta el atleta."},400);
  const serviceHeaders={apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`};
  const [profile]=await rows<{role:string}>(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=role&limit=1`,serviceHeaders);
  if(profile?.role!=="coach")return json({error:"Solo disponible para entrenadores."},403);
  const [athlete]=await rows<{family_id:string|null;training_group_id:string|null;user_profile_id:string|null}>(`${env.SUPABASE_URL}/rest/v1/athletes?id=eq.${encodeURIComponent(athleteId)}&select=family_id,training_group_id,user_profile_id&limit=1`,serviceHeaders);
  if(!athlete?.training_group_id)return json({error:"Atleta no disponible."},404);
  const assignment=await rows<{training_group_id:string}>(`${env.SUPABASE_URL}/rest/v1/training_group_coaches?coach_profile_id=eq.${encodeURIComponent(user.id)}&training_group_id=eq.${encodeURIComponent(athlete.training_group_id)}&select=training_group_id&limit=1`,serviceHeaders);
  if(!assignment.length)return json({error:"El atleta no pertenece a tus grupos."},403);
  const contacts:Contact[]=[];
  if(athlete.family_id){
    const [family]=await rows<{primary_profile_id:string;relationship_to_athlete:string;emergency_phone:string|null}>(`${env.SUPABASE_URL}/rest/v1/families?id=eq.${encodeURIComponent(athlete.family_id)}&select=primary_profile_id,relationship_to_athlete,emergency_phone&limit=1`,serviceHeaders);
    const guardians=await rows<{profile_id:string;relationship:string}>(`${env.SUPABASE_URL}/rest/v1/family_guardians?family_id=eq.${encodeURIComponent(athlete.family_id)}&access_status=eq.active&select=profile_id,relationship`,serviceHeaders);
    const links=[...guardians];
    if(family&&!links.some(item=>item.profile_id===family.primary_profile_id))links.unshift({profile_id:family.primary_profile_id,relationship:family.relationship_to_athlete});
    if(links.length){
      const profileIds=`(${links.map(item=>item.profile_id).join(",")})`;
      const people=await rows<{id:string;full_name:string|null;phone:string|null}>(`${env.SUPABASE_URL}/rest/v1/profiles?id=in.${encodeURIComponent(profileIds)}&select=id,full_name,phone`,serviceHeaders);
      for(const link of links){const person=people.find(item=>item.id===link.profile_id);if(person)contacts.push({name:person.full_name||"Tutor/a",relationship:link.relationship,phone:person.phone||(link.profile_id===family?.primary_profile_id?family.emergency_phone||"":"")});}
    }
  }else if(athlete.user_profile_id){
    const [person]=await rows<{full_name:string|null;phone:string|null}>(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(athlete.user_profile_id)}&select=full_name,phone&limit=1`,serviceHeaders);
    if(person)contacts.push({name:person.full_name||"Atleta",relationship:"contacto_personal",phone:person.phone||""});
  }
  return json({contacts});
};
