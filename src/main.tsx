import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import SportsCenter from "./components/SportsCenter";
import SelfAthleteRegistration from "./components/SelfAthleteRegistration";
import MemberExperience from "./components/MemberExperience";
import PublicClubSite from "./components/PublicClubSite";
import PublicGroupsPage from "./components/PublicGroupsPage";
import { supabase } from "./lib/supabase";
import "./assets/hero-loader";
import "./styles.css";
import "./access.css";
import "./components/family-registration.css";
import "./components/sports-center.css";
type Role="owner"|"admin"|"coach"|"parent"|"adult_athlete"|"minor_athlete";
function Root(){const params=new URLSearchParams(window.location.search);const forcedAccess=params.has("access")||params.has("signup")||params.has("invitation")||params.has("code")||window.location.hash.includes("type=recovery");const[signedIn,setSignedIn]=useState(false);const[authChecked,setAuthChecked]=useState(false);const[showAccess,setShowAccess]=useState(forcedAccess);const[role,setRole]=useState<Role|null>(null);const[profileId,setProfileId]=useState("");const sports=window.location.pathname==="/deportivo";const selfAthlete=window.location.pathname==="/alta-atleta";const publicGroups=window.location.pathname==="/grupos-precios";
useEffect(()=>{if(window.location.hostname.endsWith("pages.dev")){window.location.replace(`https://atletasdefuenlabrada.com${window.location.pathname}${window.location.search}${window.location.hash}`);return}const client=supabase;if(!client){setAuthChecked(true);return}const loadRole=async(userId:string)=>{const{data}=await client.from("profiles").select("role").eq("id",userId).maybeSingle();setRole((data?.role as Role|undefined)??null);setProfileId(userId)};const load=async()=>{const{data}=await client.auth.getSession();setSignedIn(Boolean(data.session));if(data.session)await loadRole(data.session.user.id);else{setRole(null);setProfileId("")}setAuthChecked(true)};void load();const{data:{subscription}}=client.auth.onAuthStateChange((_e,s)=>{setSignedIn(Boolean(s));if(s)void loadRole(s.user.id);else{setRole(null);setProfileId("")}setAuthChecked(true)});return()=>subscription.unsubscribe()},[]);
useEffect(()=>{if(!showAccess||signedIn||!new URLSearchParams(window.location.search).has("signup"))return;let done=false;const open=()=>{if(done)return;const b=[...document.querySelectorAll<HTMLButtonElement>("button.plain")].find(x=>x.textContent?.includes("Aún no tienes cuenta"));if(b){done=true;b.click()}};open();const o=new MutationObserver(open);o.observe(document.body,{childList:true,subtree:true});const t=setTimeout(()=>o.disconnect(),3000);return()=>{o.disconnect();clearTimeout(t)}},[showAccess,signedIn]);
if(!authChecked&&!sports&&!selfAthlete&&!publicGroups)return <main className="public-club-site public-loading"><div>Club Atletas de Fuenlabrada</div></main>;
if(selfAthlete){if(!signedIn)return <App/>;return <SelfAthleteRegistration onDone={()=>window.location.assign("/deportivo")}/>}
if(sports)return <SportsCenter/>;
const signup=()=>{window.history.replaceState({},"","/?signup=1");setShowAccess(true)};
if(!signedIn&&publicGroups)return <PublicGroupsPage onBack={()=>window.location.assign("/")} onSignup={signup}/>;
if(!signedIn&&!showAccess)return <PublicClubSite onLogin={()=>{window.history.replaceState({},"","/?access=1");setShowAccess(true)}} onSignup={signup}/>;
if(!signedIn&&showAccess)return <><button className="public-back-access" onClick={()=>{window.history.replaceState({},"","/");setShowAccess(false)}}>← Volver a la web del club</button><App/></>;
return <App/>}
createRoot(document.getElementById("root")!).render(<StrictMode><Root/></StrictMode>);
