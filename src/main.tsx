import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import SportsCenter from "./components/SportsCenter";
import { supabase } from "./lib/supabase";
import "./styles.css";
import "./access.css";
import "./components/family-registration.css";
import "./components/sports-center.css";

type Role = "owner" | "admin" | "coach" | "parent" | "adult_athlete" | "minor_athlete";

function Root() {
  const [signedIn, setSignedIn] = useState(false);
  const [role, setRole] = useState<Role | null>(null);
  const sports = window.location.pathname === "/deportivo";

  useEffect(() => {
    const client = supabase;
    if (!client) return;

    const loadRole = async (userId: string) => {
      const { data } = await client.from("profiles").select("role").eq("id", userId).maybeSingle();
      setRole((data?.role as Role | undefined) ?? null);
    };

    const loadSession = async () => {
      const { data } = await client.auth.getSession();
      const session = data.session;
      setSignedIn(Boolean(session));
      if (!session) {
        setRole(null);
        return;
      }
      await loadRole(session.user.id);
    };

    void loadSession();
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      setSignedIn(Boolean(session));
      if (!session) setRole(null);
      else void loadRole(session.user.id);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const client = supabase;
    if (!client || !signedIn || sports) return;

    const markInboxRead = async () => {
      const { data: sessionData } = await client.auth.getSession();
      const profileId = sessionData.session?.user.id;
      if (!profileId) return;
      const { data: deliveries } = await client
        .from("announcement_deliveries")
        .select("announcement_id")
        .eq("recipient_profile_id", profileId)
        .eq("channel", "app");
      const unique = [...new Set((deliveries ?? []).map(row => row.announcement_id))];
      if (unique.length) {
        await client.from("announcement_reads").upsert(
          unique.map(announcement_id => ({ announcement_id, profile_id: profileId, read_at: new Date().toISOString() })),
          { onConflict: "announcement_id,profile_id" },
        );
      }
      document.querySelectorAll(".notice-count").forEach(node => node.remove());
    };

    const enhance = () => {
      const nav = document.querySelector(".club-side nav");
      if (nav && !nav.querySelector("[data-sports-nav='true']")) {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.sportsNav = "true";
        button.textContent = role === "parent" ? "Marcas" : "Marcas y rankings";
        button.addEventListener("click", () => window.location.assign("/deportivo"));
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
          card.addEventListener("keydown", event => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              open();
            }
          });
        });
      }
    };

    const click = (event: Event) => {
      const target = event.target as HTMLElement | null;
      const button = target?.closest("button");
      const label = button?.textContent?.replace(/\d+/g, "").trim() ?? "";
      if (label.startsWith("Avisos")) void markInboxRead();
    };

    document.addEventListener("click", click, true);
    enhance();
    const observer = new MutationObserver(enhance);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      document.removeEventListener("click", click, true);
      observer.disconnect();
    };
  }, [signedIn, role, sports]);

  if (sports) return <SportsCenter />;
  return <App />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode><Root /></StrictMode>,
);
