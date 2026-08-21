import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import SportsCenter from "./components/SportsCenter";
import { supabase } from "./lib/supabase";
import "./styles.css";
import "./access.css";
import "./components/family-registration.css";
import "./components/sports-center.css";

function Root() {
  const [signedIn, setSignedIn] = useState(false);
  const sports = window.location.pathname === "/deportivo";

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => setSignedIn(Boolean(data.session)));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => setSignedIn(Boolean(session)));
    return () => subscription.unsubscribe();
  }, []);

  if (sports) return <SportsCenter />;
  return <><App />{signedIn && <a className="sports-center-shortcut" href="/deportivo">Marcas y rankings</a>}</>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode><Root /></StrictMode>,
);
