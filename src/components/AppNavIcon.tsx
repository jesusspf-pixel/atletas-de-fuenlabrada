import type { ReactNode } from "react";

const people = <><circle cx="8" cy="8" r="3"/><circle cx="16" cy="8" r="3"/><path d="M2 20a6 6 0 0 1 12 0m-4 0a6 6 0 0 1 12 0"/></>;
const trophy = <><path d="M8 4h8v5a4 4 0 0 1-8 0V4Z"/><path d="M8 6H5v1a4 4 0 0 0 4 4m6 0a4 4 0 0 0 4-4V6h-3m-4 7v4m-4 4h8"/></>;
const icons: Record<string, ReactNode> = {
  Inicio:<><path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10M9 20v-6h6v6"/></>,
  "Mi perfil":<><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>, "Mis atletas":people,"Mi grupo":people,"Mis grupos":people,Atletas:people,Grupos:people,
  Planificación:<><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8m-8 4h5"/></>,
  Asistencia:<><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4m8-4v4M3 10h18m-13 5 2 2 5-5"/></>,
  Carreras:<><path d="M5 21V4m0 1h12l-3 4 3 4H5M3 21h7"/></>,
  Avisos:<><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></>,
  "Club Challenge":trophy,Challenge:trophy,
  "Ranking del club":<><path d="M3 20V11h4v9m3 0V4h4v16m3 0v-6h4v6"/></>,
  Marcas:<><path d="M4 19V5m0 14h16M7 15l4-4 3 2 5-7"/></>,
  Cuotas:<><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18m-14 5h4"/></>,
  Tienda:<><path d="M5 8h14l1 13H4L5 8ZM9 10V6a3 3 0 0 1 6 0v4"/></>,
  Invitaciones:<><circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0m4-7v6m-3-3h6"/></>,
  Configuración:<><circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M19 5l-2 2M7 17l-2 2"/></>,
};
export default function AppNavIcon({name}:{name:string}){return <svg className="app-nav-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{icons[name]||icons.Inicio}</svg>}
