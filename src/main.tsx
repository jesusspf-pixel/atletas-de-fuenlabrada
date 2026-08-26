import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import SportsCenter from "./components/SportsCenter";
import SelfAthleteRegistration from "./components/SelfAthleteRegistration";
import MemberExperience from "./components/MemberExperience";
import PublicClubSite from "./components/PublicClubSite";
import PublicGroupsPage from "./components/PublicGroupsPage";
import CoachDesignPreview from "./components/CoachDesignPreview";
import AccountDeletion from "./components/AccountDeletion";
import { supabase } from "./lib/supabase";
import { installNativeRuntime } from "./lib/nativeRuntime";
import "./styles.css";
import "./access.css";
import "./components/family-registration.css";
import "./components/registration-visibility.css";
import "./components/sports-center.css";
import "./coach-next.css";
import "./app-visual-v2.css";
import "./admin-next.css";
import "./admin-fixes.css";
import "./responsive-guardrails.css";

installNativeRuntime();
// El acceso de ranking abre siempre la vista de resultados del área deportiva.

type Role = "owner" | "admin" | "coach" | "parent" | "adult_athlete" | "minor_athlete";

function Root() {
  const params = new URLSearchParams(window.location.search);
  const forcedAccess = params.has("access") || params.has("signup") || params.has("invitation") || params.has("code") || window.location.hash.includes("type=recovery");
  const [signedIn, setSignedIn] = useState(false);
  const [showAccess, setShowAccess] = useState(forcedAccess);
  const [role, setRole] = useState<Role | null>(null);
  const [profileId, setProfileId] = useState("");
  const sports = window.location.pathname === "/deportivo";
  const selfAthlete = window.location.pathname === "/alta-atleta";
  const publicGroups = window.location.pathname === "/grupos-precios";
  const publicClub = window.location.pathname === "/club";
  const coachDesignPreview = window.location.pathname === "/preview-entrenador";
  const accountDeletion = window.location.pathname === "/eliminar-cuenta";

  if (coachDesignPreview) return <CoachDesignPreview />;
  if (accountDeletion) return <AccountDeletion />;

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    const loadRole = async (userId: string) => {
      const { data } = await client.from("profiles").select("role").eq("id", userId).maybeSingle();
      setRole((data?.role as Role | undefined) ?? null);
      setProfileId(userId);
    };
    const load = async () => {
      const { data } = await client.auth.getSession();
      setSignedIn(Boolean(data.session));
      if (data.session) await loadRole(data.session.user.id);
      else { setRole(null); setProfileId(""); }
    };
    void load();
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      setSignedIn(Boolean(session));
      if (session) void loadRole(session.user.id);
      else { setRole(null); setProfileId(""); }
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!showAccess || signedIn || !new URLSearchParams(window.location.search).has("signup")) return;
    let done = false;
    const open = () => {
      if (done) return;
      const button = [...document.querySelectorAll<HTMLButtonElement>("button.plain")].find(item => item.textContent?.includes("Aún no tienes cuenta"));
      if (button) { done = true; button.click(); }
    };
    open();
    const observer = new MutationObserver(open);
    observer.observe(document.body, { childList: true, subtree: true });
    const timer = setTimeout(() => observer.disconnect(), 3000);
    return () => { observer.disconnect(); clearTimeout(timer); };
  }, [showAccess, signedIn]);

  // Restore the private sports navigation that existed before the public-site routing was introduced.
  useEffect(() => {
    if (!sports || !signedIn) return;
    const enhanceSportsNav = () => {
      const nav = document.querySelector(".sports-center-shell .club-side nav");
      if (!nav || nav.querySelector("[data-main-nav='true']")) return;
      const divider = document.createElement("small");
      divider.textContent = "APLICACIÓN";
      divider.dataset.mainNav = "true";
      divider.className = "sports-nav-divider";
      nav.prepend(divider);
      const labels = role === "coach"
        ? ["Inicio", "Mi grupo", "Carreras", "Avisos"]
        : role === "owner" || role === "admin"
          ? ["Inicio", "Atletas", "Grupos", "Cuotas", "Carreras", "Avisos", "Tienda"]
          : ["Inicio", role === "parent" ? "Mis atletas" : "Mi perfil", "Carreras", "Cuotas", "Avisos", "Tienda"];
      labels.reverse().forEach(label => {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.mainNav = "true";
        const icon = document.createElement("i"); icon.className = "dynamic-nav-icon"; icon.textContent = "·";
        const text = document.createElement("span"); text.textContent = label;
        button.replaceChildren(icon, text);
        button.addEventListener("click", () => window.location.assign(`/?section=${encodeURIComponent(label)}`));
        nav.prepend(button);
      });
      const title = document.createElement("small");
      title.textContent = "ÁREA DEPORTIVA";
      title.dataset.mainNav = "true";
      title.className = "sports-nav-divider";
      nav.appendChild(title);
    };
    enhanceSportsNav();
    const observer = new MutationObserver(enhanceSportsNav);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [sports, signedIn, role]);

  useEffect(() => {
    const client = supabase;
    if (!client || !signedIn || sports || selfAthlete) return;
    const sportsUrl = (name: string) => `/deportivo?athleteName=${encodeURIComponent(name.trim())}`;

    const markInboxRead = async () => {
      const { data: sessionData } = await client.auth.getSession();
      const currentProfileId = sessionData.session?.user.id;
      if (!currentProfileId) return;
      const { data: deliveries } = await client.from("announcement_deliveries").select("announcement_id").eq("recipient_profile_id", currentProfileId).eq("channel", "app");
      const unique = [...new Set((deliveries ?? []).map(row => row.announcement_id))];
      if (unique.length) {
        await client.from("announcement_reads").upsert(unique.map(announcement_id => ({ announcement_id, profile_id: currentProfileId, read_at: new Date().toISOString() })), { onConflict: "announcement_id,profile_id" });
      }
      document.querySelectorAll(".notice-count").forEach(node => node.remove());
    };

    const openRequestedSection = () => {
      const requested = new URLSearchParams(window.location.search).get("section");
      if (!requested) return;
      const button = [...document.querySelectorAll<HTMLButtonElement>(".club-side nav button")].find(item => item.textContent?.replace(/\d+/g, "").trim() === requested);
      if (button) { button.click(); window.history.replaceState({}, "", "/"); }
    };

    const mountMemberExperience = () => {
      if (role !== "adult_athlete" || !profileId) return;
      const content = document.querySelector<HTMLElement>(".club-content");
      if (!content) return;
      let mount = document.getElementById("member-experience-root");
      if (!mount) {
        mount = document.createElement("div");
        mount.id = "member-experience-root";
        content.querySelector(".topbar")?.insertAdjacentElement("afterend", mount);
      }
      if (mount.dataset.reactMounted !== "true") {
        createRoot(mount).render(<MemberExperience profileId={profileId} />);
        mount.dataset.reactMounted = "true";
      }
      const selected = document.querySelector<HTMLButtonElement>(".club-side nav button.selected")?.textContent?.replace(/\d+/g, "").trim() || "";
      const custom = selected.startsWith("Inicio") || selected.startsWith("Mi perfil");
      [...content.children].forEach(child => {
        const element = child as HTMLElement;
        if (element.classList.contains("topbar") || element.id === "member-experience-root") return;
        element.style.display = custom ? "none" : "";
      });
      mount.style.display = custom ? "block" : "none";
    };

    const enhance = () => {
      const nav = document.querySelector(".club-side nav");
      if (nav && !nav.querySelector("[data-sports-nav='true']")) {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.sportsNav = "true";
        const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        icon.setAttribute("class", "app-nav-icon"); icon.setAttribute("viewBox", "0 0 24 24"); icon.setAttribute("fill", "none"); icon.setAttribute("stroke", "currentColor"); icon.setAttribute("stroke-width", "1.8"); icon.setAttribute("stroke-linecap", "round"); icon.setAttribute("stroke-linejoin", "round"); icon.setAttribute("aria-hidden", "true");
        const bars = document.createElementNS("http://www.w3.org/2000/svg", "path"); bars.setAttribute("d", "M4.5 20V10.5h3.5V20M10.25 20V4h3.5v16M16 20v-6.5h3.5V20"); icon.appendChild(bars);
        const text = document.createElement("span"); text.textContent = "Ranking del club";
        button.replaceChildren(icon, text);
        button.addEventListener("click", () => window.location.assign("/deportivo?view=ranking"));
        nav.appendChild(button);
      }
      if (role === "parent" && nav && !nav.querySelector("[data-self-athlete='true']")) {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.selfAthlete = "true";
        const icon = document.createElement("i"); icon.className = "dynamic-nav-icon"; icon.textContent = "+";
        const text = document.createElement("span"); text.textContent = "También soy atleta";
        button.replaceChildren(icon, text);
        button.addEventListener("click", () => window.location.assign("/alta-atleta"));
        nav.appendChild(button);
      }

      if (role === "coach") {
        document.querySelectorAll<HTMLElement>(".club-content .group-card").forEach(card => {
          if (card.dataset.sportsLinked === "true") return;
          card.dataset.sportsLinked = "true";
          card.style.cursor = "pointer";
          card.setAttribute("role", "button");
          card.setAttribute("tabindex", "0");
          const open = () => {
            const groupName = card.querySelector("h2")?.textContent?.trim() || "";
            window.location.assign(`/deportivo${groupName ? `?groupName=${encodeURIComponent(groupName)}` : ""}`);
          };
          card.addEventListener("click", open);
          card.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); } });
        });
      }

      if (role === "parent") {
        document.querySelectorAll<HTMLElement>(".club-content .athlete-summary").forEach(card => {
          if (card.dataset.sportsLinked === "true") return;
          card.dataset.sportsLinked = "true";
          card.addEventListener("dblclick", () => {
            const name = card.querySelector("h2")?.textContent || "";
            if (name) window.location.assign(sportsUrl(name));
          });
        });
        document.querySelectorAll<HTMLElement>(".athlete-detail .page-head").forEach(head => {
          if (head.querySelector("[data-open-sports='true']")) return;
          const name = head.querySelector("h1")?.textContent?.trim();
          if (!name) return;
          const button = document.createElement("button");
          button.type = "button";
          button.dataset.openSports = "true";
          button.className = "outline";
          button.textContent = "Ficha deportiva completa";
          button.addEventListener("click", () => window.location.assign(sportsUrl(name)));
          head.appendChild(button);
        });
      }

      if (role === "adult_athlete") {
        document.querySelectorAll<HTMLButtonElement>(".event-card aside button").forEach(button => {
          if (button.textContent?.trim().startsWith("Apuntar a ")) button.textContent = "Solicitar inscripción";
        });
      }

      if (role === "owner" || role === "admin") {
        document.querySelectorAll<HTMLElement>(".athlete-detail .page-head").forEach(head => {
          if (head.querySelector("[data-open-sports='true']")) return;
          const name = head.querySelector("h1")?.textContent?.trim();
          if (!name) return;
          const button = document.createElement("button");
          button.type = "button";
          button.dataset.openSports = "true";
          button.className = "outline";
          button.textContent = "Ver ficha deportiva";
          button.addEventListener("click", () => window.location.assign(sportsUrl(name)));
          head.appendChild(button);
        });
        document.querySelectorAll<HTMLElement>(".group-roster span").forEach(row => {
          if (row.dataset.sportsLinked === "true") return;
          row.dataset.sportsLinked = "true";
          row.style.cursor = "pointer";
          row.setAttribute("role", "button");
          row.setAttribute("tabindex", "0");
          const name = row.childNodes[0]?.textContent?.trim() || row.textContent?.split("Activo")[0]?.trim() || "";
          const open = () => { if (name) window.location.assign(sportsUrl(name)); };
          row.addEventListener("click", open);
          row.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); } });
        });
      }
      openRequestedSection();
      mountMemberExperience();
    };

    const click = (event: Event) => {
      const target = event.target as HTMLElement | null;
      const button = target?.closest("button");
      const label = button?.textContent?.replace(/\d+/g, "").trim() ?? "";
      if (label.startsWith("Avisos")) void markInboxRead();
      window.setTimeout(enhance, 0);
    };
    document.addEventListener("click", click, true);
    enhance();
    const observer = new MutationObserver(enhance);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    return () => { document.removeEventListener("click", click, true); observer.disconnect(); };
  }, [signedIn, role, profileId, sports, selfAthlete]);

  const openSignup = () => window.location.assign("/?signup=1");
  if (publicGroups) return <PublicGroupsPage onBack={() => window.location.assign("/club")} onSignup={openSignup} />;
  if (publicClub) return <PublicClubSite onLogin={() => window.location.assign("/")} onSignup={openSignup} />;
  if (selfAthlete) {
    if (!signedIn) return <App />;
    return <SelfAthleteRegistration onDone={() => window.location.assign("/deportivo")} />;
  }
  if (sports) return <SportsCenter />;

  const signup = () => { window.history.replaceState({}, "", "/?signup=1"); setShowAccess(true); };
  if (!signedIn && !showAccess) return <PublicClubSite onLogin={() => { window.history.replaceState({}, "", "/?access=1"); setShowAccess(true); }} onSignup={signup} />;
  if (!signedIn && showAccess) return <><button className="public-back-access" onClick={() => { window.history.replaceState({}, "", "/"); setShowAccess(false); }}>← Volver a la web del club</button><App /></>;
  return <App />;
}

createRoot(document.getElementById("root")!).render(<StrictMode><Root /></StrictMode>);
