"use client";
import {useEffect,useState} from "react";
import {Capacitor} from "@capacitor/core";
import {supabase} from "../lib/supabase";

type InstallEvent=Event&{prompt:()=>Promise<void>;userChoice:Promise<{outcome:string}>};
const keyBytes=(value:string)=>{const padding="=".repeat((4-value.length%4)%4);const raw=atob((value+padding).replace(/-/g,"+").replace(/_/g,"/"));return Uint8Array.from([...raw].map(char=>char.charCodeAt(0)))};
const runningInstalled=()=>window.matchMedia("(display-mode: standalone)").matches||Boolean((navigator as Navigator&{standalone?:boolean}).standalone);

export default function PwaInstall(){
  const native=Capacitor.isNativePlatform();
  const[prompt,setPrompt]=useState<InstallEvent|null>(null);
  const[ios,setIos]=useState(false);
  const[show,setShow]=useState(false);
  const[installed,setInstalled]=useState(false);
  const[pushState,setPushState]=useState<"unsupported"|"off"|"on">("off");
  const[message,setMessage]=useState("");

  useEffect(()=>{
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent));
    setInstalled(runningInstalled());
    const pushSupported="serviceWorker" in navigator&&"PushManager" in window&&"Notification" in window;
    if(!pushSupported)setPushState("unsupported");
    else void navigator.serviceWorker.ready.then(registration=>registration.pushManager.getSubscription()).then(subscription=>setPushState(subscription?"on":"off")).catch(()=>setPushState("off"));
    const save=(event:Event)=>{event.preventDefault();setPrompt(event as InstallEvent)};
    const markInstalled=()=>{setInstalled(true);setPrompt(null);setShow(false)};
    window.addEventListener("beforeinstallprompt",save);
    window.addEventListener("appinstalled",markInstalled);
    return()=>{window.removeEventListener("beforeinstallprompt",save);window.removeEventListener("appinstalled",markInstalled)};
  },[]);

  const install=async()=>{if(prompt){await prompt.prompt();const choice=await prompt.userChoice;if(choice.outcome==="accepted")setPrompt(null)}else setShow(true)};
  const enablePush=async()=>{try{setMessage("");if(!supabase||pushState==="unsupported")throw new Error("Este dispositivo no admite notificaciones push.");const permission=await Notification.requestPermission();if(permission!=="granted")throw new Error("No se ha concedido permiso para las notificaciones.");const registration=await navigator.serviceWorker.ready;const config=await fetch("/api/public-config",{cache:"no-store"}).then(response=>response.json()) as {vapidPublicKey?:string};if(!config.vapidPublicKey)throw new Error("Las notificaciones todavía no están activadas por el club.");let subscription=await registration.pushManager.getSubscription();if(!subscription)subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:keyBytes(config.vapidPublicKey)});const{data}=await supabase.auth.getSession();const response=await fetch("/api/push-subscription",{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${data.session?.access_token||""}`},body:JSON.stringify(subscription)});if(!response.ok)throw new Error("No se pudo registrar este dispositivo.");setPushState("on");setMessage("Notificaciones activadas en este dispositivo.")}catch(error){setMessage(error instanceof Error?error.message:"No se pudieron activar las notificaciones.")}};
  const showActions=!native&&(!installed||pushState==="off");

  return <>{showActions&&<div className="pwa-actions">{!installed&&<button className="install" onClick={install}>↓ Instalar aplicación</button>}{pushState==="off"&&<button className="install" onClick={()=>void enablePush()}>🔔 Activar avisos</button>}</div>}{!native&&message&&<div className="install-help"><button onClick={()=>setMessage("")}>×</button><b>Notificaciones</b><p>{message}</p></div>}{!native&&show&&!installed&&<div className="install-help"><button onClick={()=>setShow(false)}>×</button><b>{ios?"Instalar en iPhone o iPad":"Instalar en este dispositivo"}</b><p>{ios?"Abre el menú Compartir de Safari y pulsa «Añadir a pantalla de inicio».":"Abre el menú del navegador y elige «Instalar aplicación» o «Añadir a pantalla de inicio»."}</p></div>}</>;
}
