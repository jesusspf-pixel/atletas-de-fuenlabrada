type Env = { SUPABASE_URL?: string; VITE_SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string };
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{"cache-control":"no-store"}});
async function sha256(value:string){const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return Array.from(new Uint8Array(digest)).map(byte=>byte.toString(16).padStart(2,"0")).join("")}

export async function onRequestPost(context:any){
 if(await sha256(context.request.headers.get("x-audit-key")||"")!=="c2e43c32190ae9124527f84fd926dfd922271a4a226c4e2e12a1aadf9967f719")return json({error:"Not found"},404);
 const env=context.env as Env;const base=env.SUPABASE_URL||env.VITE_SUPABASE_URL,key=env.SUPABASE_SERVICE_ROLE_KEY;if(!base||!key)return json({error:"Unavailable"},503);
 const headers={apikey:key,authorization:`Bearer ${key}`,"content-type":"application/json"};
 const [invitesResponse,profilesResponse,familiesResponse,athletesResponse]=await Promise.all([
  fetch(`${base}/rest/v1/family_renewal_invitations?select=id,email,created_by,created_at`,{headers}),
  fetch(`${base}/rest/v1/profiles?select=id,email`,{headers}),
  fetch(`${base}/rest/v1/families?select=id,primary_profile_id`,{headers}),
  fetch(`${base}/rest/v1/athletes?select=id,family_id,user_profile_id`,{headers}),
 ]);
 if(!invitesResponse.ok||!profilesResponse.ok||!familiesResponse.ok||!athletesResponse.ok)return json({error:"Audit failed"},502);
 const invites=await invitesResponse.json() as Array<any>,profiles=await profilesResponse.json() as Array<any>,families=await familiesResponse.json() as Array<any>,athletes=await athletesResponse.json() as Array<any>;
 const profileByEmail=new Map(profiles.map(p=>[String(p.email||"").trim().toLowerCase(),p.id]));const familyProfile=new Map(families.map(f=>[f.id,f.primary_profile_id]));const completedProfiles=new Set<string>();for(const athlete of athletes){if(athlete.user_profile_id)completedProfiles.add(athlete.user_profile_id);if(athlete.family_id&&familyProfile.get(athlete.family_id))completedProfiles.add(familyProfile.get(athlete.family_id))}
 const latestInviteByEmail=new Map<string,any>();for(const invite of invites){const email=String(invite.email||"").trim().toLowerCase();if(!email)continue;const current=latestInviteByEmail.get(email);if(!current||String(invite.created_at)>String(current.created_at))latestInviteByEmail.set(email,invite)}
 const pending=[...latestInviteByEmail.entries()].filter(([email])=>{const profileId=profileByEmail.get(email);return !profileId||!completedProfiles.has(profileId)});const createdBy=invites.find(i=>i.created_by)?.created_by;if(!createdBy)return json({error:"No batch owner"},409);
 const batchResponse=await fetch(`${base}/rest/v1/family_invitation_delivery_batches?select=id,token`,{method:"POST",headers:{...headers,prefer:"return=representation"},body:JSON.stringify({created_by:createdBy,total_count:pending.length})});const batch=(await batchResponse.json().catch(()=>[]))?.[0];if(!batchResponse.ok||!batch)return json({error:"Batch creation failed"},502);
 const rows=pending.map(([email])=>({email,created_by:createdBy,delivery_batch_id:batch.id,delivery_status:"pending"}));if(rows.length){const insertResponse=await fetch(`${base}/rest/v1/family_renewal_invitations`,{method:"POST",headers,body:JSON.stringify(rows)});if(!insertResponse.ok)return json({error:"Invitation creation failed",batchToken:batch.token},502)}
 return json({ok:true,eligible:rows.length,batchToken:batch.token});
}
