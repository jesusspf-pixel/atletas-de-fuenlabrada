const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{"cache-control":"no-store"}});
async function sha256(value:string){const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return Array.from(new Uint8Array(digest)).map(byte=>byte.toString(16).padStart(2,"0")).join("")}
export async function onRequestGet(context:any){
 if(await sha256(context.request.headers.get("x-audit-key")||"")!=="c2e43c32190ae9124527f84fd926dfd922271a4a226c4e2e12a1aadf9967f719")return json({error:"Not found"},404);
 const env=context.env as {SUPABASE_URL?:string;VITE_SUPABASE_URL?:string;SUPABASE_SERVICE_ROLE_KEY?:string};const base=env.SUPABASE_URL||env.VITE_SUPABASE_URL,key=env.SUPABASE_SERVICE_ROLE_KEY;if(!base||!key)return json({error:"Unavailable"},503);const headers={apikey:key,authorization:`Bearer ${key}`};
 const [invitesResponse,profilesResponse,familiesResponse,athletesResponse]=await Promise.all([
  fetch(`${base}/rest/v1/family_renewal_invitations?select=id,email,used_at,expires_at,delivery_status`,{headers}),
  fetch(`${base}/rest/v1/profiles?select=id,email`,{headers}),
  fetch(`${base}/rest/v1/families?select=id,primary_profile_id`,{headers}),
  fetch(`${base}/rest/v1/athletes?select=id,family_id,user_profile_id`,{headers}),
 ]);
 const invites=await invitesResponse.json().catch(()=>[]) as Array<any>,profiles=await profilesResponse.json().catch(()=>[]) as Array<any>,families=await familiesResponse.json().catch(()=>[]) as Array<any>,athletes=await athletesResponse.json().catch(()=>[]) as Array<any>;const profileByEmail=new Map(profiles.map(p=>[String(p.email||"").toLowerCase(),p.id]));const familyProfile=new Map(families.map(f=>[f.id,f.primary_profile_id]));const completedProfiles=new Set<string>();for(const athlete of athletes){if(athlete.user_profile_id)completedProfiles.add(athlete.user_profile_id);if(athlete.family_id&&familyProfile.get(athlete.family_id))completedProfiles.add(familyProfile.get(athlete.family_id))}
 const latestInviteByEmail=new Map<string,any>();for(const invite of invites){const email=String(invite.email||"").trim().toLowerCase();if(!email)continue;const current=latestInviteByEmail.get(email);if(!current||String(invite.id)>String(current.id))latestInviteByEmail.set(email,invite)}
 const now=Date.now();let registered=0,accountOnly=0,noAccount=0,expiredUnregistered=0;for(const [email,invite] of latestInviteByEmail){const profileId=profileByEmail.get(email);if(profileId&&completedProfiles.has(profileId)){registered++;continue}if(new Date(invite.expires_at).getTime()<=now)expiredUnregistered++;if(profileId)accountOnly++;else noAccount++}
 return json({totalInvitationRows:invites.length,uniqueRecipients:latestInviteByEmail.size,registered,accountOnly,noAccount,expiredUnregistered,eligibleForReminder:accountOnly+noAccount});
}
