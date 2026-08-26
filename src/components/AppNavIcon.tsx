import type { ReactNode } from "react";

const paths:Record<string,ReactNode>={
  "Inicio":<><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5M9 21v-7h6v7"/></>,
  "Mi perfil":<><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>,
  "Mi grupo":<><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20a6 6 0 0 1 12 0M14 15a5 5 0 0 1 7 4.5"/></>,
  "Mis grupos":<><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20a6 6 0 0 1 12 0M14 15a5 5 0 0 1 7 4.5"/></>,
  "Planificación":<><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 2v4M16 2v4M4 9h16M8 13h3M8 17h7"/></>,
  "Asistencia":<><path d="M5 3h14v18H5zM8 8h8"/><path d="m8 14 2 2 5-5"/></>,
  "Carreras":<><path d="M5 21V4M5 5h11l-2 4 2 4H5"/><path d="M9 21h8"/></>,
  "Cuotas":<><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 9h18M7 15h4"/></>,
  "Avisos":<><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></>,
  "Tienda":<><path d="M4 9h16l-1-5H5L4 9Z"/><path d="M5 9v11h14V9M9 20v-6h6v6"/></>,
  "Marcas":<><path d="M5 20V7M5 8h10l-2 3 2 3H5"/><circle cx="18" cy="18" r="3"/><path d="m18 16.5.7 1.5 1.3.2-1 1 .2 1.3-1.2-.6-1.2.6.2-1.3-1-1 1.3-.2.7-1.5Z"/></>,
  "Challenge":<><path d="M8 4h8v4a4 4 0 0 1-8 0V4Z"/><path d="M8 6H4v2a4 4 0 0 0 4 4M16 6h4v2a4 4 0 0 1-4 4M12 12v5M8 21h8M9 17h6"/></>,
  "Club Challenge":<><path d="M8 4h8v4a4 4 0 0 1-8 0V4Z"/><path d="M8 6H4v2a4 4 0 0 0 4 4M16 6h4v2a4 4 0 0 1-4 4M12 12v5M8 21h8M9 17h6"/></>,
  "Ranking del club":<><path d="M4.5 20V10.5h3.5V20M10.25 20V4h3.5v16M16 20v-6.5h3.5V20"/></>
  ,"Ranking":<><path d="M4.5 20V10.5h3.5V20M10.25 20V4h3.5v16M16 20v-6.5h3.5V20"/></>
};
export default function AppNavIcon({name}:{name:string}){return <svg className="app-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]||<circle cx="12" cy="12" r="7"/>}</svg>}
