const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
async function sha256(value: string) { const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)); return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, "0")).join(""); }
export async function onRequestGet(context: any) {
  if (await sha256(context.request.headers.get("x-audit-key") || "") !== "c2e43c32190ae9124527f84fd926dfd922271a4a226c4e2e12a1aadf9967f719") return json({ error: "Not found" }, 404);
  const env = context.env as { SUPABASE_URL?: string; VITE_SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string };
  const base=env.SUPABASE_URL||env.VITE_SUPABASE_URL,key=env.SUPABASE_SERVICE_ROLE_KEY;if(!base||!key)return json({error:"Unavailable"},503);
  const cutoff=new Date(Date.now()-3*60*60*1000).toISOString();const headers={apikey:key,authorization:`Bearer ${key}`};
  const [athletesResponse,auditsResponse]=await Promise.all([
    fetch(`${base}/rest/v1/athletes?created_at=gte.${encodeURIComponent(cutoff)}&select=id,club_status,created_at`,{headers}),
    fetch(`${base}/rest/v1/audit_log?created_at=gte.${encodeURIComponent(cutoff)}&action=in.(registration_submitted,adult_registration_submitted)&select=id,entity_id,action,created_at`,{headers}),
  ]);
  const athletes=await athletesResponse.json().catch(()=>[]) as Array<{id:string;club_status:string}>;const audits=await auditsResponse.json().catch(()=>[]) as Array<{entity_id:string;action:string}>;
  const statuses=athletes.reduce<Record<string,number>>((acc,row)=>{acc[row.club_status]=(acc[row.club_status]||0)+1;return acc},{});
  return json({cutoff,registrationsSubmitted:audits.length,athleteProfilesCreated:athletes.length,statuses});
}
