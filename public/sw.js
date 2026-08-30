const CACHE="atletas-fuenla-v19";
const APP_SHELL=["/manifest.webmanifest","/favicon.svg","/app-icon-192.png","/app-icon-512.png","/apple-touch-icon.png"];

self.addEventListener("install",event=>{
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(APP_SHELL)));
});

self.addEventListener("activate",event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET")return;
  const request=event.request;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin)return;

  if(request.mode==="navigate"){
    event.respondWith(fetch(request,{cache:"no-store"}).catch(()=>caches.match("/") ));
    return;
  }

  event.respondWith((async()=>{
    try{
      const response=await fetch(request,{cache:"no-store"});
      if(response.ok){
        const cache=await caches.open(CACHE);
        cache.put(request,response.clone());
      }
      return response;
    }catch{
      return (await caches.match(request)) || Response.error();
    }
  })());
});
self.addEventListener("push",event=>{const data=event.data?.json?.()||{};event.waitUntil(self.registration.showNotification(data.title||"Club Atletas de Fuenlabrada",{body:data.body||"Tienes una novedad.",icon:"/app-icon-192.png",badge:"/app-icon-192.png",data:{url:data.url||"/?access=1"}}))});
self.addEventListener("notificationclick",event=>{event.notification.close();event.waitUntil(clients.matchAll({type:"window",includeUncontrolled:true}).then(list=>{const url=event.notification.data?.url||"/?access=1";const open=list[0];if(open){open.navigate(url);return open.focus()}return clients.openWindow(url)}))});
