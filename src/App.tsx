import { FormEvent, ReactNode, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import PwaInstall from "./components/PwaInstall";
import FamilyRegistration from "./components/FamilyRegistration";
import AdultRegistration from "./components/AdultRegistration";
import {
  AnnouncementManager,
  CompetitionManager,
  PlanningWorkspace,
} from "./components/ClubOperations";
import {
  FamilyAthletes,
  FamilyHome,
  GroupManager,
} from "./components/ClubAdminAndFamily";
import { Shop } from "./components/ProfessionalShop";
import BillingControlCenter from "./components/BillingControlCenter";
import MemberFees from "./components/MemberFees";
import { withOfficialTrainingSchedules } from "./lib/trainingGroupSchedule";
import FamilyNotices from "./components/FamilyNotices";
import ClubChallenge from "./components/ClubChallenge";
import { AthleteResults } from "./components/AthleteResults";
import PerformanceIntelligence from "./components/PerformanceIntelligence";
import {
  CoachGroups as CoachGroupsWorkspace,
  CoachProfile,
} from "./components/CoachWorkspace";
import CoachHomeNext from "./components/CoachHomeNext";
import CoachPerformanceOverview from "./components/CoachPerformanceOverview";
import AppNavIcon from "./components/AppNavIcon";
import AdminAthleteDossier from "./components/AdminAthleteDossier";
import {
  ensureSupabase,
  supabase,
  supabasePublishableKey,
} from "./lib/supabase";
import "./club-app.css";

type Role =
  | "owner"
  | "admin"
  | "coach"
  | "parent"
  | "adult_athlete"
  | "minor_athlete";
type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  phone?: string | null;
  role: Role;
  is_demo?: boolean;
};
type Group = {
  id: string;
  name: string;
  category_label: string;
  colour: string;
  active: boolean;
  schedule_days?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  season?: string | null;
};
type Athlete = {
  id: string;
  first_name: string;
  last_name: string;
  club_status: string;
  license_status: string;
  license_number: string | null;
  training_group_id: string | null;
  family_id: string | null;
  user_profile_id: string | null;
  training_groups?: Group | null;
  birth_date?: string | null;
  federative_sex?: string | null;
  dni_nie?: string | null;
  training_category?: string | null;
  official_competition_category?: string | null;
  medical_notes?: string | null;
};
type Family = {
  relationship_to_athlete: string;
  dni_nie: string | null;
  address_line: string | null;
  postal_code: string | null;
  locality: string | null;
  province: string | null;
  emergency_phone: string | null;
  profiles?: Profile | null;
};
type AthleteRecord = Athlete & {
  families?: Family | null;
  profiles?: Profile | null;
  federation_license_applications?: {
    training_category: string | null;
    competition_category: string | null;
    form_data: Record<string, string | null> | null;
  }[];
  health_declarations?: {
    relevant_condition: boolean;
    relevant_condition_detail: string | null;
    asthma_allergy_medication: string | null;
    injury_limitation: string | null;
    support_needs: string | null;
    additional_notes: string | null;
  }[];
  memberships?: {
    id: string;
    plan: "monthly" | "term";
    enrolment_fee_cents?: number | null;
    enrolment_fee_status?: string | null;
  }[];
  consents?: { consent_type: string; accepted_at: string }[];
};
const famCalendar = "https://www.atletismomadrid.com/calendario";
const roleName: Record<Role, string> = {
  owner: "Propietario",
  admin: "Administrador",
  coach: "Entrenador",
  parent: "Familia",
  adult_athlete: "Atleta",
  minor_athlete: "Atleta menor",
};

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [registrationAccess, setRegistrationAccess] = useState<
    "allowed" | "pending"
  >("allowed");
  const [register, setRegister] = useState<"family" | "adult" | null>(null);
  const invitation = new URLSearchParams(window.location.search).get(
    "invitation",
  );
  const renewal = new URLSearchParams(window.location.search).get("renewal");

  useEffect(() => {
    let subscription: { unsubscribe: () => void } | null = null;
    let cancelled = false;

    const start = async () => {
      const client = await ensureSupabase();
      if (cancelled) return;
      if (!client) {
        setChecking(false);
        return;
      }

      const load = async (next: Session | null) => {
        setSession(next);
        if (next) {
          let { data } = await client
            .from("profiles")
            .select("*")
            .eq("id", next.user.id)
            .maybeSingle();
          if (
            !data &&
            next.user.email?.toLowerCase() === "jesusspf@gmail.com"
          ) {
            const { error } = await client.rpc("bootstrap_owner");
            if (!error)
              ({ data } = await client
                .from("profiles")
                .select("*")
                .eq("id", next.user.id)
                .maybeSingle());
          }
          if (
            !data &&
            !new URLSearchParams(window.location.search).has("invitation")
          ) {
            const { error } = await client.rpc("activate_pending_staff_access");
            if (!error)
              ({ data } = await client
                .from("profiles")
                .select("*")
                .eq("id", next.user.id)
                .maybeSingle());
          }
          if (!cancelled) {
            const loadedProfile = data as Profile | null;
            setProfile(loadedProfile);
            if (
              !loadedProfile ||
              !["parent", "adult_athlete"].includes(loadedProfile.role)
            ) {
              setRegistrationAccess("allowed");
            } else {
              let athletes: { club_status: string }[] = [];
              if (loadedProfile.role === "parent") {
                const { data: familyRows } = await client
                  .from("families")
                  .select("id")
                  .eq("primary_profile_id", next.user.id);
                const familyIds = (familyRows || []).map((item) => item.id);
                if (familyIds.length) {
                  const { data: rows } = await client
                    .from("athletes")
                    .select("club_status")
                    .in("family_id", familyIds);
                  athletes = (rows || []) as { club_status: string }[];
                }
              } else {
                const { data: rows } = await client
                  .from("athletes")
                  .select("club_status")
                  .eq("user_profile_id", next.user.id);
                athletes = (rows || []) as { club_status: string }[];
              }
              setRegistrationAccess(
                athletes.length > 0 &&
                  !athletes.some((item) => item.club_status === "active")
                  ? "pending"
                  : "allowed",
              );
            }
          }
        } else if (!cancelled) {
          setProfile(null);
          setRegistrationAccess("allowed");
        }
        if (!cancelled) setChecking(false);
      };

      const currentUrl = new URL(window.location.href);
      if (currentUrl.searchParams.get("logout") === "1" || currentUrl.searchParams.get("section") === "Salir") {
        await client.auth.signOut();
        currentUrl.searchParams.delete("logout");
        currentUrl.searchParams.delete("section");
        window.history.replaceState(
          {},
          "",
          `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`,
        );
        await load(null);
      } else
        client.auth
          .getSession()
          .then(({ data }) => void load(data.session))
          .catch(() => {
            if (!cancelled) setChecking(false);
          });
      subscription = client.auth.onAuthStateChange(
        (_event, next) => void load(next),
      ).data.subscription;
    };

    void start();
    return () => {
      cancelled = true;
      subscription?.unsubscribe();
    };
  }, []);

  if (checking)
    return (
      <main className="secure-screen">
        <div className="access-box">Comprobando el acceso seguro…</div>
      </main>
    );
  // Nunca cerramos la web por una comprobación de configuración: el formulario de acceso sigue disponible.
  if (!session) return <Access />;
  if (register === "family")
    return (
      <FamilyRegistration
        email={session.user.email ?? ""}
        renewalToken={renewal}
        onBack={() => {
          setRegister(null);
          void supabase?.auth.signOut();
        }}
      />
    );
  if (register === "adult")
    return (
      <AdultRegistration
        email={session.user.email ?? ""}
        renewalToken={renewal}
        onBack={() => {
          setRegister(null);
          void supabase?.auth.signOut();
        }}
      />
    );
  if (!profile && session.user.email?.toLowerCase() === "jesusspf@gmail.com") {
    return (
      <Portal
        profile={{
          id: session.user.id,
          email: session.user.email,
          full_name: "Jesús Pérez",
          role: "owner",
        }}
        signOut={() => void supabase?.auth.signOut()}
      />
    );
  }
  if (
    !profile &&
    new URLSearchParams(window.location.search).get("payment_method") ===
      "updated"
  )
    return new URLSearchParams(window.location.search).get("registration") ===
      "adult" ? (
      <AdultRegistration
        email={session.user.email ?? ""}
        renewalToken={renewal}
        onBack={() => {
          setRegister(null);
          void supabase?.auth.signOut();
        }}
      />
    ) : (
      <FamilyRegistration
        email={session.user.email ?? ""}
        renewalToken={renewal}
        onBack={() => {
          setRegister(null);
          void supabase?.auth.signOut();
        }}
      />
    );
  if (!profile)
    return (
      <ChooseRegistration
        email={session.user.email ?? ""}
        invitation={invitation}
        owner={session.user.email?.toLowerCase() === "jesusspf@gmail.com"}
        family={() => setRegister("family")}
        adult={() => setRegister("adult")}
        ownerAction={async () => {
          if (!supabase) return;
          const { error } = await supabase.rpc("bootstrap_owner");
          if (error) throw error;
          const { data, error: profileError } = await supabase
            .from("profiles")
            .select("*")
            .eq("id", session.user.id)
            .single();
          if (profileError) throw profileError;
          setProfile(data as Profile);
        }}
        invitationAction={async () => {
          if (!supabase || !invitation) return;
          const { error } = await supabase.rpc("accept_staff_invitation", {
            invitation_token: invitation,
          });
          if (error) throw error;
          const { data } = await supabase
            .from("profiles")
            .select("*")
            .eq("id", session.user.id)
            .single();
          window.history.replaceState({}, "", window.location.pathname);
          setProfile(data as Profile);
        }}
        staffAction={async () => {
          if (!supabase) return;
          const { error } = await supabase.rpc("activate_pending_staff_access");
          if (error) throw error;
          const { data, error: profileError } = await supabase
            .from("profiles")
            .select("*")
            .eq("id", session.user.id)
            .single();
          if (profileError) throw profileError;
          setProfile(data as Profile);
        }}
      />
    );
  if (profile && registrationAccess === "pending")
    return (
      <RegistrationPending onSignOut={() => void supabase?.auth.signOut()} />
    );
  return (
    <Portal profile={profile} signOut={() => void supabase?.auth.signOut()} />
  );
}

function RegistrationPending({ onSignOut }: { onSignOut: () => void }) {
  return (
    <main className="secure-screen">
      <section className="access-box">
        <Brand />
        <small>SOLICITUD EN REVISIÓN</small>
        <h1>
          Tu inscripción está
          <br />
          pendiente de validar.
        </h1>
        <p>
          Hemos recibido los datos y la tarjeta se ha guardado de forma segura
          en Stripe. El club debe revisar y aprobar el alta antes de habilitar
          tu acceso.
        </p>
        <p className="muted">No se ha realizado ningún cobro todavía.</p>
        <button className="outline" onClick={onSignOut}>
          Cerrar sesión
        </button>
      </section>
    </main>
  );
}
function Brand() {
  const [identity, setIdentity] = useState<{
    club_name: string;
    logo_url: string | null;
  } | null>(null);
  useEffect(() => {
    if (!supabase) return;
    void supabase
      .from("club_settings")
      .select("club_name,logo_url")
      .eq("id", true)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setIdentity(data);
      });
  }, []);
  const words = (identity?.club_name || "Club Atletas de Fuenlabrada")
    .toUpperCase()
    .split(" ");
  const first = words.slice(0, 2).join(" ");
  const second = words.slice(2).join(" ");
  return (
    <div className="portal-brand">
      {identity?.logo_url ? (
        <img src={identity.logo_url} alt="Escudo del club" />
      ) : (
        <b>AF</b>
      )}
      <span>
        {first}
        <small>{second || "DE FUENLABRADA"}</small>
      </span>
    </div>
  );
}
function LaunchBlocked() {
  return (
    <main className="secure-screen">
      <section className="access-box">
        <Brand />
        <h1>Acceso aún no abierto</h1>
        <p>
          El club está terminando la conexión segura. No hay datos de
          demostración ni inscripción abierta en esta pantalla.
        </p>
      </section>
    </main>
  );
}
function Access() {
  const [kind, setKind] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState(() => {
    const current = new URL(window.location.href);
    const queryError = current.searchParams.get("error_description");
    const hash = new URLSearchParams(current.hash.replace(/^#/, ""));
    const callbackError = queryError || hash.get("error_description");
    return callbackError
      ? `No se pudo confirmar el correo: ${callbackError.replace(/\+/g, " ")}. Solicita un enlace nuevo.`
      : "";
  });
  const [busy, setBusy] = useState(false);
  const needsConfirmation = /email not confirmed|confirmar el correo|confirm.*email/i.test(message);
  const confirmationRedirect = () => {
    const current = new URL(window.location.href);
    const redirect = new URL("/?access=1", window.location.origin);
    const invitationToken = current.searchParams.get("invitation");
    const renewalToken = current.searchParams.get("renewal");
    if (invitationToken) redirect.searchParams.set("invitation", invitationToken);
    if (renewalToken) redirect.searchParams.set("renewal", renewalToken);
    return redirect.toString();
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    const client = supabase;
    setBusy(true);
    setMessage("");
    const redirect = confirmationRedirect();
    if (kind === "login") {
      const result = await client.auth.signInWithPassword({
        email,
        password,
      });
      setBusy(false);
      setMessage(result.error?.message ?? "");
      return;
    }
    const signup = () =>
      client.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: redirect },
      });
    let result = await signup();
    if (
      result.error &&
      /error sending confirmation email/i.test(result.error.message)
    ) {
      await new Promise((resolve) => window.setTimeout(resolve, 1500));
      result = await signup();
    }
    setBusy(false);
    if (result.error) {
      const transientMailError = /error sending confirmation email/i.test(
        result.error.message,
      );
      setMessage(
        transientMailError
          ? "No se ha creado la cuenta porque el servidor de correo no respondió. Pulsa Crear cuenta para volver a intentarlo; no uses Reenviar hasta que la cuenta se haya creado."
          : result.error.message,
      );
      return;
    }
    setMessage("Cuenta creada. Revisa tu correo y confirma la cuenta.");
  };
  const resendConfirmation = async () => {
    if (!supabase || !email) {
      setMessage("Escribe primero el correo de la cuenta.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: confirmationRedirect() },
    });
    setBusy(false);
    setMessage(
      error
        ? `No se pudo enviar el nuevo correo: ${error.message}`
        : "Nuevo correo enviado. Utiliza únicamente el enlace más reciente.",
    );
  };
  return (
    <main className="secure-screen">
      <section className="access-box">
        <Brand />
        <small>ACCESO SEGURO</small>
        <h1>{kind === "login" ? "Entra en tu cuenta" : "Crea tu cuenta"}</h1>
        <p>
          {kind === "login"
            ? "Familias, atletas y equipo acceden con su correo y contraseña."
            : "El registro público es solo para familias y atletas mayores de edad."}
        </p>
        <form onSubmit={submit}>
          <label>
            Correo electrónico
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            Contraseña
            <input
              required
              minLength={8}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button disabled={busy}>
            {busy
              ? "Creando la cuenta…"
              : kind === "login"
                ? "Entrar"
                : "Crear cuenta"}
          </button>
        </form>
        {message && <p className="error-note">{message}</p>}
        {needsConfirmation && (
          <button className="outline" disabled={busy} onClick={() => void resendConfirmation()}>
            Enviar un nuevo correo de confirmación
          </button>
        )}
        <button
          className="plain"
          onClick={() => {
            setKind(kind === "login" ? "signup" : "login");
            setMessage("");
          }}
        >
          {kind === "login"
            ? "¿Aún no tienes cuenta? Inicia tu inscripción"
            : "¿Ya tienes una cuenta? Entrar"}
        </button>
        <p className="muted">
          Administradores y entrenadores reciben una invitación personal del
          club.
        </p>
      </section>
    </main>
  );
}
function ChooseRegistration({
  email,
  owner,
  invitation,
  family,
  adult,
  ownerAction,
  invitationAction,
  staffAction,
}: {
  email: string;
  owner: boolean;
  invitation: string | null;
  family: () => void;
  adult: () => void;
  ownerAction: () => Promise<void>;
  invitationAction: () => Promise<void>;
  staffAction: () => Promise<void>;
}) {
  const [error, setError] = useState("");
  const run = async (action: () => Promise<void>, fallback: string) => {
    try {
      setError("");
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : fallback);
    }
  };
  return (
    <main className="secure-screen">
      <section className="access-box">
        <Brand />
        {owner ? (
          <>
            <small>ACTIVACIÓN INICIAL</small>
            <h1>Activa tu acceso de propietario</h1>
            <p>
              Esta cuenta será el primer administrador. Después podrás invitar
              al equipo desde el panel.
            </p>
            <button
              onClick={() =>
                void run(ownerAction, "No se pudo activar la administración.")
              }
            >
              Activar mi administración
            </button>
            {error && <p className="error-note">{error}</p>}
          </>
        ) : invitation ? (
          <>
            <small>INVITACIÓN DEL CLUB</small>
            <h1>Activa tu acceso</h1>
            <p>
              La invitación se vinculará a la cuenta {email} y aplicará el rol y
              grupo asignados por el club.
            </p>
            <button
              onClick={() =>
                void run(invitationAction, "No se pudo aceptar la invitación.")
              }
            >
              Aceptar invitación
            </button>
            {error && <p className="error-note">{error}</p>}
          </>
        ) : (
          <>
            <small>INSCRIPCIÓN O EQUIPO</small>
            <h1>¿Qué acceso necesitas?</h1>
            <p>Cuenta: {email}</p>
            <button onClick={family}>Soy padre, madre o tutor</button>
            <button className="outline" onClick={adult}>
              Soy atleta mayor de 18 años
            </button>
            <button
              className="plain"
              onClick={() =>
                void run(staffAction, "No se pudo activar el acceso de equipo.")
              }
            >
              Tengo una invitación como entrenador o administrador
            </button>
            <p className="muted">
              Si el correo tiene una invitación activa, se abrirá
              automáticamente el panel correspondiente.
            </p>
            {error && <p className="error-note">{error}</p>}
          </>
        )}
      </section>
    </main>
  );
}

function useRows<T>(table: string, select = "*") {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const reload = async (silent = false) => {
    if (!supabase) return;
    if (!silent) setLoading(true);
    setError("");
    const { data, error: queryError } = await supabase
      .from(table)
      .select(select);
    setRows((table === "training_groups" ? withOfficialTrainingSchedules((data ?? []) as any[]) : (data ?? [])) as T[]);
    setError(queryError?.message ?? "");
    setLoading(false);
  };
  useEffect(() => {
    void reload();
    const refresh = () => void reload(true);
    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const interval = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [table, select]);
  return { rows, loading, error, reload };
}
function Header({
  title,
  text,
  children,
}: {
  title: string;
  text: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        <p>{text}</p>
      </div>
      {children}
    </div>
  );
}
function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
function Portal({
  profile,
  signOut,
}: {
  profile: Profile;
  signOut: () => void;
}) {
  const [section, setSection] = useState(
    () => new URLSearchParams(window.location.search).get("section") || "Inicio",
  );
  const [focusedAthleteId, setFocusedAthleteId] = useState("");
  const [adminAthleteId, setAdminAthleteId] = useState("");
  const [adminAthleteReturnSection, setAdminAthleteReturnSection] = useState("Atletas");
  const [challengeAthleteId, setChallengeAthleteId] = useState("");
  const [ownAthleteId, setOwnAthleteId] = useState("");
  const [ownAthleteGroupName, setOwnAthleteGroupName] = useState("");
  const [memberAvatarUrl, setMemberAvatarUrl] = useState("");
  const goToSection = (nextSection: string) => {
    setAdminAthleteId("");
    if (nextSection !== "Mis atletas" && nextSection !== "Mis menores") {
      setFocusedAthleteId("");
    }
    setSection(nextSection);
  };
  const coachAssignments = useRows<{ coach_profile_id: string }>(
    "training_group_coaches",
    "coach_profile_id",
  );
  const coachGroupLabel =
    coachAssignments.rows.filter((item) => item.coach_profile_id === profile.id)
      .length === 1
      ? "Mi grupo"
      : "Mis grupos";
  const baseMenu =
    profile.role === "coach"
      ? [
          "Inicio",
          "Mi perfil",
          coachGroupLabel,
          "Planificación",
          "Asistencia",
          "Carreras",
          "Avisos",
          "Rendimiento",
          "Club Challenge",
        ]
      : ["owner", "admin"].includes(profile.role)
        ? [
            "Inicio",
            "Atletas",
            "Grupos",
            "Entrenadores",
            "Cuotas",
            "Carreras",
            "Asistencia",
            "Avisos",
            "Invitaciones",
            "Tienda",
            "Rendimiento",
            "Configuración",
          ]
        : profile.role === "minor_athlete"
          ? ["Inicio", "Mi perfil", "Carreras", "Avisos"]
          : [
              "Inicio",
              profile.role === "parent" ? "Mis atletas" : "Mi perfil",
              "Carreras",
              "Cuotas",
              "Avisos",
              "Tienda",
            ];
  useEffect(() => {
    if (!supabase) return;
    void (async () => {
      const { data: athleteData } = await supabase
        .from("athletes")
        .select("id,user_profile_id,training_groups(name),families!athletes_family_id_fkey(primary_profile_id)");
      const ownRows = (athleteData || [])
        .filter(
          (athlete: any) =>
            athlete.user_profile_id === profile.id ||
            athlete.families?.primary_profile_id === profile.id,
        );
      const primaryAthlete = ownRows.find((athlete: any) => athlete.user_profile_id === profile.id) || ownRows[0];
      const own = ownRows.map((athlete: any) => athlete.id);
      setOwnAthleteId(primaryAthlete?.id || "");
      const primaryGroup = Array.isArray(primaryAthlete?.training_groups) ? primaryAthlete.training_groups[0] : primaryAthlete?.training_groups;
      setOwnAthleteGroupName(primaryGroup?.name || "");
      if (!own.length) {
        setChallengeAthleteId("");
        const { data: coachSettings } = await supabase
          .from("coach_profile_settings")
          .select("avatar_url")
          .eq("profile_id", profile.id)
          .maybeSingle();
        setMemberAvatarUrl(coachSettings?.avatar_url || "");
        return;
      }
      const { data: settings } = await supabase
        .from("athlete_profile_settings")
        .select("athlete_id,avatar_url,challenge_opt_in")
        .in("athlete_id", own);
      setChallengeAthleteId(
        settings?.find((item) => item.challenge_opt_in)?.athlete_id || "",
      );
      setMemberAvatarUrl(
        settings?.find((item) => item.athlete_id === own[0])?.avatar_url || "",
      );
    })();
  }, [profile.id]);
  const memberMenu = profile.role === "minor_athlete"
    ? [...baseMenu, "Marcas"]
    : ["parent", "adult_athlete"].includes(profile.role)
      ? [...baseMenu, "Marcas", ...(/running/i.test(ownAthleteGroupName) ? ["Rendimiento"] : []), "Challenge"]
      : baseMenu;
  const menu = memberMenu;
  const notices = useRows<{ id: string; created_by: string }>(
    "announcements",
    "id,created_by",
  );
  const deliveries = useRows<{
    announcement_id: string;
    recipient_profile_id: string;
  }>("announcement_deliveries", "announcement_id,recipient_profile_id");
  const reads = useRows<{ announcement_id: string; profile_id: string }>(
    "announcement_reads",
    "announcement_id,profile_id",
  );
  const mine = new Set(
    deliveries.rows
      .filter((item) => item.recipient_profile_id === profile.id)
      .map((item) => item.announcement_id),
  );
  const inbox = notices.rows
    .filter((item) => item.created_by !== profile.id && mine.has(item.id))
    .map((item) => item.id);
  const unread = inbox.filter(
    (id) =>
      !reads.rows.some(
        (read) => read.announcement_id === id && read.profile_id === profile.id,
      ),
  ).length;
  useEffect(() => {
    const timer = window.setInterval(() => {
      void notices.reload();
      void deliveries.reload();
      void reads.reload();
    }, 15000);
    return () => window.clearInterval(timer);
  }, []);
  const openAthlete = (id: string) => {
    setFocusedAthleteId(id);
    setSection("Mis atletas");
  };
  const joinChallenge = async () => {
    if (!supabase || !ownAthleteId) return;
    const { error } = await supabase
      .from("athlete_profile_settings")
      .upsert(
        {
          athlete_id: ownAthleteId,
          challenge_opt_in: true,
          show_activity_to_club: true,
        },
        { onConflict: "athlete_id" },
      );
    if (!error) setChallengeAthleteId(ownAthleteId);
  };
  const roleClass =
    profile.role === "coach"
      ? "coach-next-shell"
      : ["parent", "adult_athlete", "minor_athlete"].includes(profile.role)
        ? "member-next-shell"
        : "admin-next-shell";
  const portalContent =
    profile.role === "minor_athlete" && section === "Challenge" ? (
      <><Header title="Acceso deportivo" text="El Challenge se gestiona desde la cuenta familiar." /><article className="panel"><h2>Sección reservada a la familia</h2><p>El padre, madre o tutor puede decidir la participación en el Challenge desde su cuenta.</p></article></>
    ) : section === "Challenge" ? (
      challengeAthleteId ? (
        <>
          <Header
            title="Club Challenge"
            text="Tu reto semanal, logros y clasificación dentro del club."
          />
          <ClubChallenge athleteId={challengeAthleteId} />
        </>
      ) : (
        <>
          <Header
            title="Club Challenge"
            text="Participa en los retos y comparativas amistosas entre grupos."
          />
          <article className="panel challenge-join">
            <h2>Únete al Club Challenge</h2>
            <p>
              Al unirte, tus estadísticas deportivas compartidas contarán en la
              clasificación del club. Podrás salir cuando quieras desde la
              edición de tu perfil.
            </p>
            <button
              disabled={!ownAthleteId}
              onClick={() => void joinChallenge()}
            >
              Unirme al Club Challenge
            </button>
          </article>
        </>
      )
    ) : section === "Rendimiento" && ownAthleteId && /running/i.test(ownAthleteGroupName) ? (
      <>
        <Header
          title="Centro de rendimiento"
          text="Carga, forma, fatiga, recuperación y análisis inteligente de tus entrenamientos."
        />
        <PerformanceIntelligence athleteId={ownAthleteId} />
      </>
    ) : section === "Marcas" && ownAthleteId ? (
      <>
        <Header
          title="Mis marcas de entrenamiento"
          text="Registra una marca y consulta tu histórico y tus mejores resultados."
        />
        <AthleteResults
          athleteId={ownAthleteId}
          canAddTraining
          coachProfileId={profile.id}
        />
      </>
    ) : section === "Mis menores" && profile.role !== "minor_athlete" ? (
      <FamilyAthletes initialAthleteId={focusedAthleteId} dependentsOnly />
    ) : ["owner", "admin"].includes(profile.role) ? (
      <Admin
        section={section}
        profile={profile}
        go={goToSection}
        athleteId={adminAthleteId}
        openAthlete={(id) => {
          setAdminAthleteReturnSection(section);
          setAdminAthleteId(id);
          setSection(section === "Altas en revisión" ? section : "Atletas");
        }}
        closeAthlete={() => {
          setAdminAthleteId("");
          setSection(adminAthleteReturnSection);
        }}
      />
    ) : profile.role === "coach" ? (
      <Coach section={section} profile={profile} go={goToSection} />
    ) : (
      <Member
        section={section}
        profile={profile}
        go={goToSection}
        openAthlete={openAthlete}
        focusedAthleteId={focusedAthleteId}
      />
    );
  const isMember = ["parent", "adult_athlete", "minor_athlete"].includes(
    profile.role,
  );
  return (
    <main
      className={`club-shell visual-next-shell ${roleClass}`}
      data-role={profile.role}
    >
      <aside className="club-side">
        {memberAvatarUrl ? (
          <div className="portal-brand member-menu-avatar">
            <img src={memberAvatarUrl} alt="Foto de perfil" />
          </div>
        ) : isMember ? (
          <div className="portal-brand member-menu-avatar">
            <b>
              {(profile.full_name || profile.email).slice(0, 2).toUpperCase()}
            </b>
          </div>
        ) : (
          <Brand />
        )}
        <small className="side-role">
          {profile.is_demo ? "Atleta · Demo" : roleName[profile.role]}
        </small>
        <nav>
          {menu.map((item) => (
            <button
              className={section === item || (section === "Altas en revisión" && item === "Atletas") ? "selected" : ""}
              key={item}
              onClick={() => goToSection(item)}
            >
              <AppNavIcon name={item} />
              <span>{item}</span>
              {item === "Avisos" && unread > 0 && (
                <b className="notice-count">{unread > 99 ? "99+" : unread}</b>
              )}
            </button>
          ))}
          <button
            type="button"
            className="nav-signout"
            onClick={signOut}
            aria-label="Cerrar sesión"
          >
            <AppNavIcon name="Salir" />
            <span>Salir</span>
          </button>
        </nav>
      </aside>
      <section className="club-content">
        <header className="topbar">
          <span>
            {profile.is_demo
              ? "MODO DEMOSTRACIÓN · Sin cobros reales"
              : "Club Atletas de Fuenlabrada"}
          </span>
          <PwaInstall />
        </header>
        <div className="visual-page-body" data-section={section === "Altas en revisión" ? "Atletas" : section}>
          {portalContent}
        </div>
        <footer className="platform-credit">
          Desarrollado por <b>Sportmed Integral Solutions, S.L.</b>
        </footer>
      </section>
    </main>
  );
}

function Admin({
  section,
  profile,
  go,
  athleteId,
  openAthlete,
  closeAthlete,
}: {
  section: string;
  profile: Profile;
  go: (section: string) => void;
  athleteId: string;
  openAthlete: (id: string) => void;
  closeAthlete: () => void;
}) {
  let content: ReactNode;
  if (section === "Atletas" || section === "Altas en revisión")
    content = athleteId ? (
      <AdminAthleteDossier athleteId={athleteId} adminProfileId={profile.id} onBack={closeAthlete} />
    ) : (
      <AthletesAdmin onOpenAthlete={openAthlete} statusFilter={section === "Altas en revisión" ? "pending_review" : undefined} />
    );
  else if (section === "Grupos") content = <GroupManager onOpenAthlete={openAthlete} />;
  else if (section === "Entrenadores") content = <CoachesAdmin />;
  else if (section === "Invitaciones") content = <Invitations />;
  else if (section === "Cuotas") content = <Fees profile={profile} />;
  else if (section === "Tienda") content = <Shop profile={profile} />;
  else if (section === "Carreras")
    content = <CompetitionManager profile={profile} manager />;
  else if (section === "Asistencia") content = <Attendance profile={profile} />;
  else if (section === "Avisos")
    content = <AnnouncementManager profile={profile} />;
  else if (section === "Rendimiento")
    content = <CoachPerformanceOverview profileId={profile.id} allGroups />;
  else if (section === "Configuración") content = <Settings />;
  else content = <AdminHome profile={profile} go={go} />;
  return (
    <section className="admin-reference-page" data-admin-screen={section === "Altas en revisión" ? "Atletas" : section}>
      <div className="admin-reference-art" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <div className="admin-reference-sheet">{content}</div>
    </section>
  );
}

function CoachesAdmin() {
  const profiles = useRows<Profile>("profiles", "id,email,full_name,phone,role");
  const settings = useRows<{
    profile_id: string;
    avatar_url: string | null;
    public_phone: string | null;
    bio: string | null;
  }>("coach_profile_settings", "profile_id,avatar_url,public_phone,bio");
  const assignments = useRows<{
    training_group_id: string;
    coach_profile_id: string;
  }>("training_group_coaches", "training_group_id,coach_profile_id");
  const groups = useRows<Group>(
    "training_groups",
    "id,name,category_label,active,schedule_days,starts_at,ends_at,colour",
  );
  const coaches = profiles.rows
    .filter((person) => person.role === "coach")
    .sort((a, b) =>
      (a.full_name || a.email).localeCompare(b.full_name || b.email, "es"),
    );
  const assignedCoaches = new Set(
    assignments.rows.map((assignment) => assignment.coach_profile_id),
  );
  const error = profiles.error || settings.error || assignments.error || groups.error;
  const initials = (person: Profile) =>
    (person.full_name || person.email)
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("");
  return (
    <>
      <Header
        title="Entrenadores"
        text="Equipo técnico registrado y grupos que tiene asignados. Esta información solo es visible para administración."
      />
      <section className="coach-admin-metrics">
        <article>
          <small>ENTRENADORES REGISTRADOS</small>
          <b>{coaches.length}</b>
          <span>Con acceso al panel técnico</span>
        </article>
        <article>
          <small>CON GRUPO ASIGNADO</small>
          <b>{coaches.filter((coach) => assignedCoaches.has(coach.id)).length}</b>
          <span>Ya vinculados a uno o más grupos</span>
        </article>
        <article className={coaches.some((coach) => !assignedCoaches.has(coach.id)) ? "attention" : ""}>
          <small>SIN GRUPO</small>
          <b>{coaches.filter((coach) => !assignedCoaches.has(coach.id)).length}</b>
          <span>Pendientes de asignación</span>
        </article>
      </section>
      {error && <p className="error-note panel">No se pudo cargar todo el equipo técnico: {error}</p>}
      <section className="coach-admin-grid">
        {coaches.map((coach) => {
          const coachSettings = settings.rows.find((item) => item.profile_id === coach.id);
          const coachGroups = assignments.rows
            .filter((item) => item.coach_profile_id === coach.id)
            .map((item) => groups.rows.find((group) => group.id === item.training_group_id))
            .filter((group): group is Group => Boolean(group))
            .sort((a, b) => a.name.localeCompare(b.name, "es", { numeric: true }));
          return (
            <article className="coach-admin-card" key={coach.id}>
              <header>
                {coachSettings?.avatar_url ? (
                  <img src={coachSettings.avatar_url} alt="" />
                ) : (
                  <i>{initials(coach)}</i>
                )}
                <div>
                  <small>ENTRENADOR REGISTRADO</small>
                  <h2>{coach.full_name || "Nombre pendiente"}</h2>
                </div>
                <em>Activo</em>
              </header>
              <dl>
                <div><dt>Correo</dt><dd>{coach.email || "No indicado"}</dd></div>
                <div><dt>Teléfono</dt><dd>{coach.phone || coachSettings?.public_phone || "No indicado"}</dd></div>
              </dl>
              {coachSettings?.bio && <p>{coachSettings.bio}</p>}
              <footer>
                <small>GRUPOS ASIGNADOS</small>
                <div>
                  {coachGroups.map((group) => <span key={group.id}>{group.name}</span>)}
                  {!coachGroups.length && <strong>Sin grupos asignados</strong>}
                </div>
              </footer>
            </article>
          );
        })}
        {!profiles.loading && !coaches.length && !error && (
          <Empty>Todavía no hay entrenadores registrados.</Empty>
        )}
      </section>
    </>
  );
}
function AdminHome({
  profile,
  go,
}: {
  profile: Profile;
  go: (section: string) => void;
}) {
  const athletes = useRows<Athlete>(
    "athletes",
    "id,first_name,last_name,club_status",
  );
  const groups = useRows<Group>("training_groups");
  const orders = useRows<{
    id: string;
    status: string;
    total_cents: number;
    created_at: string;
  }>("club_orders", "id,status,total_cents,created_at");
  const ledger = useRows<{ id: string; status: string; amount_cents: number }>(
    "payment_ledger",
    "id,status,amount_cents",
  );
  const chargeDrafts = useRows<{
    id: string;
    status: string;
    charge_kind: string;
  }>("billing_charge_drafts", "id,status,charge_kind");
  const pendingRows = athletes.rows.filter(
    (a) => a.club_status === "pending_review",
  );
  const pendingOrders = orders.rows.filter(
    (order) => !["paid", "cancelled"].includes(order.status),
  );
  const failedCharges = chargeDrafts.rows.filter(
    (item) => item.status === "failed",
  );
  const queryError =
    athletes.error ||
    groups.error ||
    orders.error ||
    ledger.error ||
    chargeDrafts.error;
  return (
    <>
      <Header
        title={`Buenos días, ${profile.full_name?.split(" ")[0] || "Jesús"}`}
        text="Resumen real del club."
      />
      {queryError && (
        <p className="error-note panel">
          No se pudieron consultar los datos: {queryError}
        </p>
      )}
      <section className="metric-grid">
        <Metric
          label="Atletas registrados"
          value={`${athletes.rows.length}`}
          onClick={() => go("Atletas")}
        />
        <Metric
          label="Altas en revisión"
          value={`${pendingRows.length}`}
          onClick={() => go("Altas en revisión")}
        />
        <Metric
          label="Grupos activos"
          value={`${groups.rows.filter((g) => g.active).length}`}
          onClick={() => go("Grupos")}
        />
        <Metric
          label="Pedidos pendientes"
          value={`${pendingOrders.length}`}
          onClick={() => go("Tienda")}
        />
      </section>
      {failedCharges.length > 0 && (
        <p className="error-note panel">
          <b>Atención:</b> {failedCharges.length} cargo(s) rechazado(s). Puedes
          reintentarlos, modificarlos o cancelarlos desde Cuotas.
        </p>
      )}
      <section className="two-columns">
        <article
          className="panel actionable-panel"
          onClick={() => go("Altas en revisión")}
        >
          <h2>
            Altas pendientes <span>Ver atletas →</span>
          </h2>
          {pendingRows.length ? (
            pendingRows.map((a) => (
              <p key={a.id}>
                {a.first_name} {a.last_name}
              </p>
            ))
          ) : (
            <Empty>
              {athletes.loading
                ? "Consultando solicitudes…"
                : "No hay solicitudes pendientes."}
            </Empty>
          )}
        </article>
        <article
          className="panel actionable-panel"
          onClick={() => go("Cuotas")}
        >
          <h2>
            Pedidos y cobros <span>Gestionar →</span>
          </h2>
          <p>
            <b>{pendingOrders.length}</b> pedido(s) por preparar o cobrar.
          </p>
          <p>
            <b>{failedCharges.length}</b> cargo(s) rechazado(s).
          </p>
        </article>
      </section>
      <section className="quick-actions panel">
        <h2>Acciones rápidas</h2>
        <button onClick={() => go("Atletas")}>Revisar atletas</button>
        <button onClick={() => go("Grupos")}>Gestionar grupos</button>
        <button onClick={() => go("Asistencia")}>
          Ver asistencia en directo
        </button>
        <button onClick={() => go("Invitaciones")}>Invitar entrenador</button>
        <button onClick={() => go("Configuración")}>Configurar el club</button>
      </section>
    </>
  );
}
function Metric({
  label,
  value,
  onClick,
}: {
  label: string;
  value: string;
  onClick?: () => void;
}) {
  return (
    <button
      className={`metric ${onClick ? "metric-action" : ""}`}
      onClick={onClick}
    >
      <small>{label}</small>
      <b>{value}</b>
      <em>Ver →</em>
    </button>
  );
}
function AthletesAdmin({ onOpenAthlete, statusFilter }: { onOpenAthlete: (id: string) => void; statusFilter?: string }) {
  const { rows, loading, error, reload } = useRows<AthleteRecord>(
    "athletes",
    "*,profiles:user_profile_id(*),training_groups(*),families!athletes_family_id_fkey(*,profiles:profiles!families_primary_profile_id_fkey(*)),memberships(*),consents(*),federation_license_applications(training_category,competition_category,form_data),health_declarations(relevant_condition,relevant_condition_detail,asthma_allergy_medication,injury_limitation,support_needs,additional_notes)",
  );
  const groups = useRows<Group>("training_groups");
  const avatarSettings = useRows<{
    athlete_id: string;
    avatar_url: string | null;
  }>("athlete_profile_settings", "athlete_id,avatar_url");
  const [selectedId, setSelectedId] = useState("");
  const [changing, setChanging] = useState("");
  const [message, setMessage] = useState("");
  const selected = rows.find((a) => a.id === selectedId) || null;
  const [groupId, setGroupId] = useState("");
  const [status, setStatus] = useState("");
  const [licenseStatus, setLicenseStatus] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [waiveEnrolment, setWaiveEnrolment] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<"monthly" | "term">("term");
  const [enrolmentFee, setEnrolmentFee] = useState("");
  const [athleteSearch, setAthleteSearch] = useState("");
  const baseRows = statusFilter ? rows.filter((athlete) => athlete.club_status === statusFilter) : rows;
  const normalizedSearch = athleteSearch.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
  const visibleRows = normalizedSearch
    ? baseRows.filter((athlete) => `${athlete.first_name} ${athlete.last_name}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es").includes(normalizedSearch))
    : baseRows;
  useEffect(() => {
    if (selected) {
      const membership = selected.memberships?.[0];
      setGroupId(selected.training_group_id || "");
      setStatus(
        selected.club_status === "pending_review"
          ? "active"
          : selected.club_status,
      );
      setLicenseStatus(selected.license_status);
      setLicenseNumber(selected.license_number || "");
      setSelectedPlan(membership?.plan || "term");
      setEnrolmentFee(
        ((membership?.enrolment_fee_cents || 0) / 100).toFixed(2),
      );
      setWaiveEnrolment(membership?.enrolment_fee_status === "paid");
      setMessage("");
    }
  }, [selectedId]);
  const save = async () => {
    if (!selected || !supabase) return;
    setChanging(selected.id);
    setMessage("");
    const isInitialApproval =
      selected.club_status === "pending_review" && status === "active";
    if (isInitialApproval) {
      const membership = selected.memberships?.[0];
      if (!membership) {
        setChanging("");
        return setMessage(
          "No se encontró el plan económico de esta inscripción.",
        );
      }
      const finalEnrolmentCents = waiveEnrolment
        ? 0
        : Math.round(Number(enrolmentFee.replace(",", ".")) * 100);
      if (!Number.isFinite(finalEnrolmentCents) || finalEnrolmentCents < 0) {
        setChanging("");
        return setMessage("Indica un importe de matrícula válido.");
      }
      const { error: economicError } = await supabase
        .from("memberships")
        .update({
          plan: selectedPlan,
          enrolment_fee_cents: finalEnrolmentCents,
        })
        .eq("id", membership.id);
      if (economicError) {
        setChanging("");
        return setMessage(economicError.message);
      }
      const { data, error } = await supabase.rpc(
        "approve_registration_and_schedule",
        { target_athlete_id: selected.id, waive_enrolment: waiveEnrolment },
      );
      if (error) {
        setChanging("");
        return setMessage(error.message);
      }
      const draftId = Array.isArray(data) ? data[0]?.enrolment_draft_id : null;
      if (draftId) {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const response = await fetch("/api/collect-approved-charge", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${session?.access_token || ""}`,
            "x-supabase-key": supabasePublishableKey,
          },
          body: JSON.stringify({ draftId }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          setChanging("");
          setStatus("pending_review");
          void reload();
          return setMessage(
            result.error ||
              "El banco ha rechazado la matrícula. El atleta continúa pendiente.",
          );
        }
      }
      const { error: detailsError } = await supabase
        .from("athletes")
        .update({
          training_group_id: groupId || null,
          license_status: licenseStatus,
          license_number: licenseNumber || null,
        })
        .eq("id", selected.id);
      setChanging("");
      if (detailsError) return setMessage(detailsError.message);
      setMessage(
        waiveEnrolment
          ? "Alta validada: matrícula exenta y cuotas programadas."
          : "Alta validada, matrícula cobrada y cuotas programadas.",
      );
      void reload();
      return;
    }
    const { error: saveError } = await supabase
      .from("athletes")
      .update({
        training_group_id: groupId || null,
        club_status: status,
        license_status: licenseStatus,
        license_number: licenseNumber || null,
      })
      .eq("id", selected.id);
    if (
      !saveError &&
      selected.memberships?.[0] &&
      ["inactive", "withdrawn"].includes(status)
    ) {
      await supabase
        .from("memberships")
        .update({
          billing_status: status === "withdrawn" ? "cancelled" : "paused",
          suspension_reason:
            status === "withdrawn"
              ? "Baja administrativa"
              : "Acceso suspendido por administración",
          access_suspended_at: new Date().toISOString(),
        })
        .eq("id", selected.memberships[0].id);
    }
    if (!saveError && selected.memberships?.[0] && status === "active") {
      await supabase
        .from("memberships")
        .update({
          billing_status: "active",
          suspension_reason: null,
          access_suspended_at: null,
        })
        .eq("id", selected.memberships[0].id);
    }
    setChanging("");
    if (saveError) return setMessage(saveError.message);
    setMessage("Ficha actualizada.");
    void reload();
  };
  const consentNames: Record<string, string> = {
    privacy: "Privacidad",
    image_use: "Uso de imagen",
    fam_data: "Datos FAM",
    club_rules: "Normativa del club",
    recurring_payment: "Pago recurrente",
  };
  const avatarFor = (id: string) =>
    avatarSettings.rows.find((item) => item.athlete_id === id)?.avatar_url ||
    "";
  const registrationContact = (athlete: AthleteRecord) =>
    athlete.families?.profiles || athlete.profiles || null;
  return (
    <>
      <Header
        title={statusFilter === "pending_review" ? "Altas en revisión" : "Atletas"}
        text={statusFilter === "pending_review" ? "Solo aparecen las solicitudes que todavía necesitan validación administrativa." : "Pulsa un atleta para abrir su ficha completa y gestionar su alta, grupo y licencia."}
      />
      {error && (
        <p className="error-note panel">
          No se pudieron consultar las solicitudes: {error}
        </p>
      )}
      <div className="athlete-search-bar">
        <label htmlFor="admin-athlete-search">Buscar atleta</label>
        <div>
          <span aria-hidden="true">⌕</span>
          <input
            id="admin-athlete-search"
            type="search"
            value={athleteSearch}
            onChange={(event) => setAthleteSearch(event.target.value)}
            placeholder="Nombre o apellidos"
            autoComplete="off"
          />
          {athleteSearch && <button type="button" onClick={() => setAthleteSearch("")} aria-label="Limpiar búsqueda">×</button>}
        </div>
        <small>{visibleRows.length} de {baseRows.length} atleta{baseRows.length === 1 ? "" : "s"}</small>
      </div>
      <div className="panel table">
        {loading
          ? "Cargando…"
          : visibleRows.map((a) => (
              <button
                className={`row athlete-row ${selectedId === a.id ? "selected-row" : ""}`}
                key={a.id}
                onClick={() => onOpenAthlete(a.id)}
              >
                <span className="admin-athlete-avatar">
                  {avatarFor(a.id) ? (
                    <img
                      src={avatarFor(a.id)}
                      alt={`Foto de ${a.first_name}`}
                    />
                  ) : (
                    <i>
                      {a.first_name[0]}
                      {a.last_name[0]}
                    </i>
                  )}
                </span>
                <span>
                  <b>
                    {a.first_name} {a.last_name}
                  </b>
                  <small>{a.training_groups?.name || "Sin grupo"}</small>
                  {registrationContact(a) && (
                    <small>
                      {registrationContact(a)?.email} · {registrationContact(a)?.phone || a.families?.emergency_phone || "Sin teléfono"}
                    </small>
                  )}
                </span>
                <span>
                  {a.club_status === "pending_review"
                    ? "En revisión"
                    : a.club_status === "active"
                      ? "Activo"
                      : a.club_status === "inactive"
                        ? "Suspendido"
                        : "Baja"}
                </span>
                <span>
                  Licencia:{" "}
                  {a.license_status === "active"
                    ? a.license_number || "activa"
                    : "pendiente"}
                </span>
                <span>Ver ficha →</span>
              </button>
            ))}
        {!loading && !visibleRows.length && !error && (
          <Empty>{athleteSearch ? "No hay atletas que coincidan con la búsqueda." : statusFilter === "pending_review" ? "No hay altas pendientes de revisión." : "Aún no hay atletas registrados."}</Empty>
        )}
      </div>
      {selected && (
        <section className="athlete-detail">
          <div className="admin-athlete-detail-head">
            {avatarFor(selected.id) ? (
              <img
                src={avatarFor(selected.id)}
                alt={`Foto de ${selected.first_name}`}
              />
            ) : (
              <i>
                {selected.first_name[0]}
                {selected.last_name[0]}
              </i>
            )}
          </div>
          <Header
            title={`${selected.first_name} ${selected.last_name}`}
            text="Expediente del atleta y datos declarados durante la inscripción."
          >
            <button className="outline" onClick={() => setSelectedId("")}>
              Cerrar ficha
            </button>
          </Header>
          <div className="detail-grid">
            <article className="panel">
              <h2>Datos completos del atleta</h2>
              <p><b>Nombre:</b> {selected.first_name} {selected.last_name}</p>
              <p><b>Fecha de nacimiento:</b> {selected.birth_date ? new Date(`${selected.birth_date}T12:00:00`).toLocaleDateString("es-ES") : "No indicada"}</p>
              <p><b>Sexo federativo:</b> {selected.federative_sex === "F" ? "Femenino" : selected.federative_sex === "M" ? "Masculino" : "No indicado"}</p>
              <p><b>DNI / NIE:</b> {selected.dni_nie || "No indicado"}</p>
              <p><b>Categoría de entrenamiento:</b> {selected.training_category || "No indicada"}</p>
              <p><b>Categoría de competición:</b> {selected.official_competition_category || "No indicada"}</p>
              <p><b>Correo:</b> {registrationContact(selected)?.email || "No indicado"}</p>
              <p><b>Teléfono:</b> {registrationContact(selected)?.phone || "No indicado"}</p>
            </article>
            <article className="panel">
              <h2>Padre, madre o tutor</h2>
              <p>
                <b>
                  {selected.families?.profiles?.full_name ||
                    "Sin tutor asociado"}
                </b>
              </p>
              <p>
                {selected.families?.profiles?.email || "Correo no disponible"}
              </p>
              <p>
                Teléfono: {selected.families?.profiles?.phone || "No indicado"}
              </p>
              <p>
                Teléfono de emergencia:{" "}
                {selected.families?.emergency_phone || "No indicado"}
              </p>
              <p>
                Relación:{" "}
                {selected.families?.relationship_to_athlete || "No indicada"}
              </p>
              <p><b>DNI / NIE del responsable:</b> {selected.families?.dni_nie || "No indicado"}</p>
              <p><b>Domicilio:</b> {selected.families?.address_line || "No indicado"}</p>
              <p><b>Código postal:</b> {selected.families?.postal_code || "No indicado"}</p>
              <p><b>Localidad:</b> {selected.families?.locality || "No indicada"}</p>
              <p><b>Provincia:</b> {selected.families?.province || "No indicada"}</p>
            </article>
            {selected.federation_license_applications?.[0] && (() => {
              const application = selected.federation_license_applications![0];
              const data = application.form_data || {};
              return <article className="panel">
                <h2>Ficha federativa</h2>
                <p><b>Nacionalidad:</b> {data.nationality || "No indicada"}</p>
                <p><b>Localidad de nacimiento:</b> {data.birthplace || "No indicada"}</p>
                <p><b>Licencia anterior:</b> {data.previous_license || "No indicada"}</p>
                <p><b>Club anterior:</b> {data.previous_club || "No indicado"}</p>
                <p><b>Categoría FAM:</b> {application.training_category || "No indicada"}</p>
                <p><b>Categoría de competición:</b> {application.competition_category || "No indicada"}</p>
              </article>;
            })()}
            {selected.health_declarations?.[0] && (() => {
              const health = selected.health_declarations![0];
              return <article className="panel">
                <h2>Información de salud declarada</h2>
                <small>Información privada visible únicamente para administración autorizada.</small>
                <p><b>Condición relevante:</b> {health.relevant_condition ? "Sí" : "No"}</p>
                <p><b>Detalle:</b> {health.relevant_condition_detail || "No indicado"}</p>
                <p><b>Asma, alergias o medicación:</b> {health.asthma_allergy_medication || "No indicado"}</p>
                <p><b>Lesión o limitación:</b> {health.injury_limitation || "No indicada"}</p>
                <p><b>Necesidades de apoyo:</b> {health.support_needs || "No indicadas"}</p>
                <p><b>Observaciones:</b> {health.additional_notes || selected.medical_notes || "No indicadas"}</p>
              </article>;
            })()}
            <article className="panel">
              <h2>Solicitud económica</h2>
              <p>
                <b>
                  {selectedPlan === "monthly"
                    ? "Cuota mensual · 35 €"
                    : "Cuota trimestral · 70 €"}
                </b>
              </p>
              <p>
                Matrícula final:{" "}
                {waiveEnrolment
                  ? "Exenta / ya abonada"
                  : (enrolmentFee || "0.00") + " €"}
              </p>
              <small>
                Al validar, el plan e importe final quedan aprobados y se
                programa automáticamente todo el calendario. No habrá que
                preparar ni aprobar cobros después.
              </small>
            </article>
            <article className="panel">
              <h2>Consentimientos</h2>
              <p>La inscripción no solicita ni muestra datos médicos.</p>
              <small>
                {selected.consents?.length
                  ? selected.consents
                      .map(
                        (c) => consentNames[c.consent_type] || c.consent_type,
                      )
                      .join(" · ")
                  : "Sin consentimientos registrados"}
              </small>
            </article>
            <article className="panel">
              <h2>Gestión deportiva</h2>
              <label>
                Estado de alta
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <option value="pending_review">En revisión</option>
                  <option value="active">Activo</option>
                  <option value="inactive">Acceso suspendido</option>
                  <option value="withdrawn">Baja del club</option>
                </select>
              </label>
              <small>
                Suspender o dar de baja bloquea el acceso y los cobros, pero
                conserva resultados, ranking e historial económico.
              </small>
              {selected.club_status === "pending_review" &&
                status === "active" && (
                  <>
                    <label>
                      Plan de cuotas
                      <select
                        value={selectedPlan}
                        onChange={(e) =>
                          setSelectedPlan(e.target.value as "monthly" | "term")
                        }
                      >
                        <option value="monthly">Mensual · 35 €</option>
                        <option value="term">Trimestral · 70 €</option>
                      </select>
                    </label>
                    <label>
                      Matrícula final (€)
                      <input
                        required={!waiveEnrolment}
                        disabled={waiveEnrolment}
                        min="0"
                        step="0.01"
                        inputMode="decimal"
                        value={enrolmentFee}
                        onChange={(e) => setEnrolmentFee(e.target.value)}
                      />
                    </label>
                    <label className="check-line">
                      <input
                        type="checkbox"
                        checked={waiveEnrolment}
                        onChange={(e) => setWaiveEnrolment(e.target.checked)}
                      />
                      Matrícula ya abonada / exenta
                    </label>
                  </>
                )}
              <label>
                Grupo
                <select
                  value={groupId}
                  onChange={(e) => setGroupId(e.target.value)}
                >
                  <option value="">Sin grupo</option>
                  {groups.rows
                    .filter((g) => g.active)
                    .map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Licencia
                <select
                  value={licenseStatus}
                  onChange={(e) => setLicenseStatus(e.target.value)}
                >
                  <option value="pending">Pendiente</option>
                  <option value="active">Activa</option>
                  <option value="rejected">Rechazada</option>
                </select>
              </label>
              <label>
                Número de licencia
                <input
                  value={licenseNumber}
                  onChange={(e) => setLicenseNumber(e.target.value)}
                  placeholder="Ej. M-12345"
                />
              </label>
              <button
                disabled={changing === selected.id}
                onClick={() => void save()}
              >
                {changing === selected.id
                  ? "Validando y programando cuotas…"
                  : selected.club_status === "pending_review" &&
                      status === "active"
                    ? waiveEnrolment
                      ? "Validar alta y programar cuotas"
                      : "Validar alta, cobrar matrícula y programar cuotas"
                    : "Guardar cambios"}
              </button>
              {message && (
                <p
                  className={
                    message.includes("validada") ||
                    message === "Ficha actualizada."
                      ? "success-note"
                      : "error-note"
                  }
                >
                  {message}
                </p>
              )}
            </article>
          </div>
        </section>
      )}
    </>
  );
}
function Groups({ profile }: { profile: Profile }) {
  const { rows, reload } = useRows<Group>("training_groups");
  const coaches = useRows<Profile>("profiles", "id,email,full_name,role");
  const assignments = useRows<{
    training_group_id: string;
    coach_profile_id: string;
  }>("training_group_coaches");
  const [selectedId, setSelectedId] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const blank = {
    name: "",
    category_label: "",
    colour: "#2563eb",
    schedule_days: "",
    starts_at: "",
    ends_at: "",
    season: "2026",
    active: true,
  };
  const [form, setForm] = useState(blank);
  const [coachIds, setCoachIds] = useState<string[]>([]);
  const selected = rows.find((row) => row.id === selectedId);
  useEffect(() => {
    if (!selected) return;
    setForm({
      name: selected.name,
      category_label: selected.category_label,
      colour: selected.colour,
      schedule_days: selected.schedule_days || "",
      starts_at: selected.starts_at?.slice(0, 5) || "",
      ends_at: selected.ends_at?.slice(0, 5) || "",
      season: selected.season || "2026",
      active: selected.active,
    });
    setCoachIds(
      assignments.rows
        .filter((item) => item.training_group_id === selected.id)
        .map((item) => item.coach_profile_id),
    );
    setNotice("");
  }, [selectedId, rows.length, assignments.rows.length]);
  const startNew = () => {
    setSelectedId("");
    setForm(blank);
    setCoachIds([]);
    setNotice("");
  };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setSaving(true);
    setNotice("");
    const payload = {
      ...form,
      starts_at: form.starts_at || null,
      ends_at: form.ends_at || null,
      schedule_days: form.schedule_days || null,
    };
    const result = selectedId
      ? await supabase
          .from("training_groups")
          .update(payload)
          .eq("id", selectedId)
          .select("id")
          .single()
      : await supabase
          .from("training_groups")
          .insert(payload)
          .select("id")
          .single();
    if (result.error || !result.data) {
      setSaving(false);
      return setNotice(result.error?.message || "No se pudo guardar el grupo.");
    }
    const groupId = result.data.id;
    const { error: removeError } = await supabase
      .from("training_group_coaches")
      .delete()
      .eq("training_group_id", groupId);
    if (removeError) {
      setSaving(false);
      return setNotice(removeError.message);
    }
    if (coachIds.length) {
      const { error: assignError } = await supabase
        .from("training_group_coaches")
        .insert(
          coachIds.map((coach_profile_id) => ({
            training_group_id: groupId,
            coach_profile_id,
          })),
        );
      if (assignError) {
        setSaving(false);
        return setNotice(assignError.message);
      }
    }
    setSelectedId(groupId);
    setSaving(false);
    setNotice("Grupo y entrenadores guardados.");
    void reload();
    void assignments.reload();
  };
  const coachesOnly = coaches.rows.filter((person) => person.role === "coach");
  return (
    <>
      <Header
        title="Grupos"
        text="Pulsa un grupo para ver su ficha, editar el horario y asignar entrenadores."
      >
        <button onClick={startNew}>Nuevo grupo</button>
      </Header>
      <div className="cards">
        {rows.map((g) => (
          <button
            className={`panel group-card group-button ${selectedId === g.id ? "selected-row" : ""}`}
            key={g.id}
            onClick={() => setSelectedId(g.id)}
          >
            <i style={{ background: g.colour }} />
            <h2>{g.name}</h2>
            <p>{g.category_label}</p>
            <small>
              {g.schedule_days
                ? `${g.schedule_days} · ${g.starts_at?.slice(0, 5)}–${g.ends_at?.slice(0, 5)}`
                : "Horario pendiente"}
            </small>
            <small>
              {
                assignments.rows.filter(
                  (item) => item.training_group_id === g.id,
                ).length
              }{" "}
              entrenador(es) asignado(s)
            </small>
          </button>
        ))}
        {!rows.length && <Empty>Aún no hay grupos creados.</Empty>}
      </div>
      <form className="panel group-editor" onSubmit={save}>
        <h2>
          {selected ? `Ficha del grupo: ${selected.name}` : "Nuevo grupo"}
        </h2>
        <div className="ops-grid">
          <label>
            Nombre
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Sub 14"
            />
          </label>
          <label>
            Categoría
            <input
              required
              value={form.category_label}
              onChange={(e) =>
                setForm({ ...form, category_label: e.target.value })
              }
              placeholder="Sub 14"
            />
          </label>
          <label>
            Días de entrenamiento
            <input
              value={form.schedule_days}
              onChange={(e) =>
                setForm({ ...form, schedule_days: e.target.value })
              }
              placeholder="Lunes a jueves"
            />
          </label>
          <label>
            Hora de inicio
            <input
              type="time"
              value={form.starts_at}
              onChange={(e) => setForm({ ...form, starts_at: e.target.value })}
            />
          </label>
          <label>
            Hora de final
            <input
              type="time"
              value={form.ends_at}
              onChange={(e) => setForm({ ...form, ends_at: e.target.value })}
            />
          </label>
          <label>
            Temporada
            <input
              value={form.season}
              onChange={(e) => setForm({ ...form, season: e.target.value })}
              placeholder="2026"
            />
          </label>
          <label>
            Color
            <input
              type="color"
              value={form.colour}
              onChange={(e) => setForm({ ...form, colour: e.target.value })}
            />
          </label>
          <label className="check-line">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm({ ...form, active: e.target.checked })}
            />
            Grupo activo
          </label>
        </div>
        <fieldset className="coach-picker">
          <legend>Entrenadores asignados</legend>
          {coachesOnly.length ? (
            coachesOnly.map((person) => (
              <label key={person.id}>
                <input
                  type="checkbox"
                  checked={coachIds.includes(person.id)}
                  onChange={(e) =>
                    setCoachIds(
                      e.target.checked
                        ? [...coachIds, person.id]
                        : coachIds.filter((id) => id !== person.id),
                    )
                  }
                />
                {person.full_name || person.email} <small>{person.email}</small>
              </label>
            ))
          ) : (
            <p className="muted">
              Todavía no hay entrenadores con cuenta. Créales primero una
              invitación desde «Invitaciones».
            </p>
          )}
        </fieldset>
        <button disabled={saving}>
          {saving ? "Guardando…" : "Guardar grupo y entrenadores"}
        </button>
        {notice && (
          <p
            className={
              notice.startsWith("Grupo") ? "success-note" : "error-note"
            }
          >
            {notice}
          </p>
        )}
      </form>
    </>
  );
}
function Invitations() {
  const groups = useRows<Group>("training_groups");
  const staffLinks = useRows<{
    id: string;
    email: string | null;
    role: string;
    expires_at: string;
    accepted_at: string | null;
  }>("invitation_links");
  const renewalLinks = useRows<{
    id: string;
    email: string;
    token: string;
    expires_at: string;
    used_at: string | null;
  }>("family_renewal_invitations");
  const [kind, setKind] = useState<"staff" | "renewal" | "demo">("staff");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "coach">("coach");
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [link, setLink] = useState("");
  const [error, setError] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLink("");
    if (!supabase) return;
    if (kind === "renewal") {
      const { data, error: rpcError } = await supabase.rpc(
        "create_family_renewal_invitation",
        { target_email: email },
      );
      if (rpcError) return setError(rpcError.message);
      const item = (data as { invitation_token: string }[] | null)?.[0];
      if (!item?.invitation_token)
        return setError("No se pudo crear el enlace de renovación.");
      setLink(window.location.origin + "/?renewal=" + item.invitation_token);
      setEmail("");
      void renewalLinks.reload();
      return;
    }
    if (kind === "demo") {
      const { data, error: rpcError } = await supabase.rpc(
        "create_demo_athlete_invitation",
        { target_email: email },
      );
      if (rpcError) return setError(rpcError.message);
      setLink(
        window.location.origin +
          "/?invitation=" +
          (data as { token: string }).token,
      );
      setEmail("");
      void staffLinks.reload();
      return;
    }
    const { data, error: rpcError } = await supabase.rpc(
      "create_staff_invitation_multi",
      {
        target_email: email,
        target_role: role,
        target_group_ids: role === "coach" ? selectedGroups : [],
      },
    );
    if (rpcError) return setError(rpcError.message);
    setLink(
      window.location.origin +
        "/?invitation=" +
        (data as { token: string }).token,
    );
    setEmail("");
    void staffLinks.reload();
  };

  const invitationTypes = [
    {
      value: "staff" as const,
      icon: "EQ",
      title: "Equipo del club",
      text: "Entrenador o administrador",
    },
    {
      value: "demo" as const,
      icon: "DE",
      title: "Atleta de demostración",
      text: "Acceso de prueba sin pagos",
    },
    {
      value: "renewal" as const,
      icon: "FA",
      title: "Familia renovada",
      text: "Revisar matrícula y cuota",
    },
  ];
  return (
    <>
      <Header
        title="Invitaciones"
        text="Crea accesos personales y decide con claridad qué podrá hacer cada invitado."
      />
      <form className="panel invite-form invite-workspace" onSubmit={submit}>
        <section className="invite-step">
          <header>
            <span>1</span>
            <div>
              <h2>Elige el tipo de acceso</h2>
              <p>Selecciona a quién quieres invitar.</p>
            </div>
          </header>
          <div className="invite-type-grid">
            {invitationTypes.map((item) => (
              <button
                type="button"
                key={item.value}
                className={kind === item.value ? "selected" : ""}
                onClick={() => {
                  setKind(item.value);
                  setLink("");
                  setError("");
                }}
              >
                <i>{item.icon}</i>
                <span>
                  <b>{item.title}</b>
                  <small>{item.text}</small>
                </span>
                <em>{kind === item.value ? "✓" : "›"}</em>
              </button>
            ))}
          </div>
        </section>
        <section className="invite-step invite-details">
          <header>
            <span>2</span>
            <div>
              <h2>Configura la invitación</h2>
              <p>
                {kind === "staff"
                  ? "Indica el correo, el rol y sus grupos."
                  : kind === "demo"
                    ? "Puedes asociarla a un correo o crear un enlace abierto."
                    : "Vincúlala al correo de la familia."}
              </p>
            </div>
          </header>
          <div className="invite-field-grid">
            <label>
              <span>
                {kind === "demo"
                  ? "Correo de destino · opcional"
                  : "Correo de destino"}
              </span>
              <input
                type="email"
                required={kind !== "demo"}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={
                  kind === "demo"
                    ? "Vacío = enlace abierto"
                    : "persona@correo.com"
                }
              />
            </label>
            {kind === "staff" && (
              <label>
                <span>Permiso dentro del club</span>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as "admin" | "coach")}
                >
                  <option value="coach">Entrenador</option>
                  <option value="admin">Administrador</option>
                </select>
              </label>
            )}
          </div>
          {kind === "staff" && role === "coach" && (
            <fieldset className="coach-picker invite-group-picker">
              <legend>Grupos a los que tendrá acceso</legend>
              <label className="invite-select-all">
                <input
                  type="checkbox"
                  checked={
                    selectedGroups.length === groups.rows.filter((g) => g.active).length &&
                    groups.rows.some((g) => g.active)
                  }
                  onChange={(e) =>
                    setSelectedGroups(
                      e.target.checked ? groups.rows.filter((g) => g.active).map((g) => g.id) : [],
                    )
                  }
                />
                <span>
                  <b>Todos los grupos</b>
                  <small>Permite gestionar cualquier grupo actual</small>
                </span>
              </label>
              <div className="invite-groups-grid">
                {groups.rows.filter((g) => g.active).map((g) => (
                  <label key={g.id}>
                    <input
                      type="checkbox"
                      checked={selectedGroups.includes(g.id)}
                      onChange={(e) =>
                        setSelectedGroups(
                          e.target.checked
                            ? [...selectedGroups, g.id]
                            : selectedGroups.filter((id) => id !== g.id),
                        )
                      }
                    />
                    <span>
                      <b>{g.name}</b>
                      <small>{g.schedule_days || g.category_label}</small>
                    </span>
                  </label>
                ))}
              </div>
              {!selectedGroups.length && (
                <p>Podrás asignar los grupos más tarde.</p>
              )}
            </fieldset>
          )}
          {kind === "renewal" && (
            <aside className="invite-info">
              La familia añadirá su tarjeta y elegirá la cuota. La matrícula se
              decide al validar cada atleta.
            </aside>
          )}
          {kind === "demo" && (
            <aside className="invite-info">
              Este acceso abre el panel completo de atleta con cuotas ficticias.
              Stripe queda totalmente desactivado.
            </aside>
          )}
          <button className="invite-submit">
            {kind === "renewal"
              ? "Crear enlace de renovación"
              : kind === "demo"
                ? "Crear acceso de demostración"
                : `Invitar como ${role === "coach" ? "entrenador" : "administrador"}`}
          </button>
          {error && <p className="error-note">{error}</p>}
        </section>
      </form>
      {link && (
        <article className="panel invite-created">
          <span>✓</span>
          <div>
            <small>INVITACIÓN PREPARADA</small>
            <h2>Enlace creado correctamente</h2>
            <p className="link-box">{link}</p>
            <small>
              {kind === "renewal"
                ? "Caduca en 30 días y solo sirve para ese correo."
                : "Caduca en 14 días."}
            </small>
          </div>
          <button onClick={() => void navigator.clipboard.writeText(link)}>
            Copiar enlace
          </button>
        </article>
      )}
      <article className="panel table invite-history">
        <header>
          <div>
            <small>SEGUIMIENTO</small>
            <h2>
              {kind === "renewal"
                ? "Renovaciones creadas"
                : "Invitaciones recientes"}
            </h2>
          </div>
        </header>
        {kind === "renewal" ? (
          <>
            {renewalLinks.rows.map((i) => (
              <div className="row" key={i.id}>
                <span>
                  <b>{i.email}</b>
                  <small>Revisión individual de matrícula</small>
                </span>
                <span
                  className={
                    i.used_at ? "invite-status accepted" : "invite-status"
                  }
                >
                  {i.used_at ? "Utilizada" : "Pendiente"}
                </span>
                <span>
                  Caduca {new Date(i.expires_at).toLocaleDateString("es-ES")}
                </span>
              </div>
            ))}
            {!renewalLinks.rows.length && (
              <Empty>No hay enlaces de renovación creados.</Empty>
            )}
          </>
        ) : (
          <>
            {staffLinks.rows.map((i) => (
              <div className="row" key={i.id}>
                <span>
                  <b>{i.email || "Enlace abierto de demostración"}</b>
                  <small>
                    {i.role === "coach"
                      ? "Entrenador"
                      : i.role === "admin"
                        ? "Administrador"
                        : "Atleta de demostración"}
                  </small>
                </span>
                <span
                  className={
                    i.accepted_at ? "invite-status accepted" : "invite-status"
                  }
                >
                  {i.accepted_at ? "Aceptada" : "Pendiente"}
                </span>
                <span>
                  Caduca {new Date(i.expires_at).toLocaleDateString("es-ES")}
                </span>
              </div>
            ))}
            {!staffLinks.rows.length && (
              <Empty>No hay invitaciones creadas.</Empty>
            )}
          </>
        )}
      </article>
    </>
  );
}
function Fees({ profile }: { profile: Profile }) {
  const manager = ["owner", "admin"].includes(profile.role);
  if (!manager) return <MemberFees isDemo={profile.is_demo} />;
  const charges = useRows<{
    id: string;
    charge_kind: "enrolment" | "recurring" | "manual";
    calculated_amount_cents: number;
    approved_amount_cents: number | null;
    status: string;
    scheduled_for: string | null;
  }>(
    "billing_charge_drafts",
    "id,charge_kind,calculated_amount_cents,approved_amount_cents,status,scheduled_for",
  );
  if (manager) return <BillingControlCenter />;
  const [cardBusy, setCardBusy] = useState(false);
  const [cardMessage, setCardMessage] = useState("");
  const addCard = async () => {
    if (!supabase) return;
    setCardBusy(true);
    setCardMessage("");
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      setCardBusy(false);
      setCardMessage(
        "Tu sesión ha caducado. Vuelve a entrar antes de añadir la tarjeta.",
      );
      return;
    }
    const response = await fetch("/api/create-payment-method-setup", {
      method: "POST",
      headers: { authorization: `Bearer ${session.access_token}` },
    });
    const body = (await response.json().catch(() => ({}))) as {
      url?: string;
      error?: string;
    };
    if (!response.ok || !body.url) {
      setCardBusy(false);
      setCardMessage(
        body.error || "No se pudo abrir Stripe. Inténtalo de nuevo.",
      );
      return;
    }
    window.location.assign(body.url);
  };
  const kindName = {
    enrolment: "Matrícula",
    recurring: "Cuota",
    manual: "Ajuste",
  };
  const statusName: Record<string, string> = {
    awaiting_admin: "Pendiente de revisión",
    approved: "Aprobada",
    checkout_pending: "Pendiente de pago",
    paid: "Pagada",
    failed: "Pago pendiente",
    waived: "Exenta",
    cancelled: "Cancelada",
  };
  return (
    <>
      <Header
        title="Cuotas y cobros"
        text={
          profile.role === "parent"
            ? "Consulta las cuotas de tus atletas vinculados y su estado."
            : "Consulta tus próximos cobros y su estado."
        }
      />
      <section className="two-columns">
        <article className="panel">
          <small>STRIPE · PAGO SEGURO</small>
          <h2>Tarjeta para las cuotas</h2>
          <p>
            La tarjeta se añade directamente en Stripe. El club no recibe ni
            guarda el número ni el CVV.
          </p>
          <button disabled={cardBusy} onClick={() => void addCard()}>
            {cardBusy ? "Abriendo Stripe…" : "Añadir o cambiar tarjeta"}
          </button>
          {cardMessage && <p className="error-note">{cardMessage}</p>}
        </article>
        <article className="panel">
          <h2>Pagos seguros</h2>
          <p>El club revisa y aprueba cada cuota antes de cobrarla.</p>
          <p>Las cuotas aprobadas aparecen aquí vinculadas a esta familia.</p>
        </article>
      </section>
      {charges.error && (
        <p className="error-note panel">
          No se pudieron consultar las cuotas: {charges.error}
        </p>
      )}
      <article className="panel table">
        {charges.rows.map((item) => {
          const amount =
            item.approved_amount_cents ?? item.calculated_amount_cents;
          return (
            <div className="row" key={item.id}>
              <span>
                <b>{kindName[item.charge_kind]}</b>
                <small>
                  {item.scheduled_for
                    ? `Prevista: ${new Date(`${item.scheduled_for}T00:00:00`).toLocaleDateString("es-ES")}`
                    : "Sin fecha prevista"}
                </small>
              </span>
              <span>{(amount / 100).toFixed(2)} €</span>
              <span>{statusName[item.status] || item.status}</span>
            </div>
          );
        })}
        {!charges.loading && !charges.rows.length && !charges.error && (
          <Empty>No hay cobros creados aún.</Empty>
        )}
      </article>
    </>
  );
}

function useCoachGroups() {
  return useRows<any>("training_group_coaches", "training_groups(*)");
}
function Coach({
  section,
  profile,
  go,
}: {
  section: string;
  profile: Profile;
  go: (section: string) => void;
}) {
  if (section === "Inicio") return <CoachHomeNext profile={profile} go={go} />;
  let content: ReactNode;
  if (section === "Mi grupo" || section === "Mis grupos")
    content = <CoachGroupsWorkspace profile={profile} />;
  else if (section === "Mi perfil")
    content = <CoachProfile profile={profile} />;
  else if (section === "Planificación")
    content = <PlanningWorkspace profile={profile} />;
  else if (section === "Asistencia") content = <Attendance profile={profile} />;
  else if (section === "Carreras")
    content = <CompetitionManager profile={profile} manager />;
  else if (section === "Avisos")
    content = <AnnouncementManager profile={profile} />;
  else if (section === "Rendimiento")
    return <section className="coach-reference-page coach-performance-reference"><div className="coach-reference-art" aria-hidden="true"><i/><i/><i/></div><div className="coach-reference-sheet"><CoachPerformanceOverview profileId={profile.id}/></div></section>;
  else if (section === "Club Challenge")
    content = (
      <>
        <Header
          title="Club Challenge"
          text="Retos, logros y clasificación del club."
        />
        <ClubChallenge />
      </>
    );
  else
    content = (
      <>
        <Header
          title="Ranking del club"
          text="Clasificación y marcas de todos los atletas."
        />
        <a className="button-link" href="/deportivo?view=ranking">
          Abrir ranking completo →
        </a>
      </>
    );
  return (
    <section className="coach-reference-page" data-coach-screen={section}>
      <div className="coach-reference-art" aria-hidden="true">
        <i />
        <i />
        <i />
        <b>AF</b>
      </div>
      <div className="coach-reference-sheet">{content}</div>
    </section>
  );
}
function CoachGroups() {
  const assigned = useCoachGroups();
  const ids = assigned.rows
    .map((item) => item.training_groups?.id)
    .filter(Boolean);
  const athletes = useRows<Athlete>("athletes", "*,training_groups(*)");
  const mine = athletes.rows.filter((a) => ids.includes(a.training_group_id));
  return (
    <>
      <Header
        title="Mi grupo"
        text="Atletas de los grupos que tienes asignados."
      />
      <article className="panel table">
        {mine.map((a) => (
          <div className="row" key={a.id}>
            <span>
              <b>
                {a.first_name} {a.last_name}
              </b>
              <small>{a.training_groups?.name}</small>
            </span>
            <span>
              Licencia:{" "}
              {a.license_status === "active"
                ? a.license_number || "activa"
                : "pendiente"}
            </span>
            <span>{a.club_status}</span>
          </div>
        ))}
        {!mine.length && <Empty>No hay atletas visibles en tus grupos.</Empty>}
      </article>
    </>
  );
}
function Plans({ profile }: { profile: Profile }) {
  const assigned = useCoachGroups();
  const groups = assigned.rows
    .map((item) => item.training_groups)
    .filter(Boolean) as Group[];
  const plans = useRows<{
    id: string;
    title: string;
    body: string;
    week_starts_on: string;
    training_group_id: string;
  }>("training_plans");
  const [form, setForm] = useState({
    group: "",
    title: "",
    body: "",
    week: new Date().toISOString().slice(0, 10),
  });
  const [error, setError] = useState("");
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const { error: insertError } = await supabase!
      .from("training_plans")
      .upsert(
        {
          training_group_id: form.group,
          title: form.title,
          body: form.body,
          week_starts_on: form.week,
          published_at: new Date().toISOString(),
          created_by: profile.id,
        },
        { onConflict: "training_group_id,week_starts_on" },
      );
    if (insertError) return setError(insertError.message);
    setForm({
      group: "",
      title: "",
      body: "",
      week: new Date().toISOString().slice(0, 10),
    });
    void plans.reload();
  };
  return (
    <>
      <Header
        title="Planificación"
        text="Publica el plan semanal de tus grupos. La marca de agua se incluirá al compartir."
      />
      <form className="panel stacked-form" onSubmit={save}>
        <label>
          Grupo
          <select
            required
            value={form.group}
            onChange={(e) => setForm({ ...form, group: e.target.value })}
          >
            <option value="">Selecciona un grupo</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Título
          <input
            required
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </label>
        <label>
          Inicio de semana
          <input
            required
            type="date"
            value={form.week}
            onChange={(e) => setForm({ ...form, week: e.target.value })}
          />
        </label>
        <label>
          Plan
          <textarea
            required
            value={form.body}
            onChange={(e) => setForm({ ...form, body: e.target.value })}
          />
        </label>
        <button>Publicar planificación</button>
        {error && <p className="error-note">{error}</p>}
      </form>
      <div className="cards">
        {plans.rows
          .filter((p) => groups.some((g) => g.id === p.training_group_id))
          .map((p) => (
            <article className="panel plan" key={p.id}>
              <small>CLUB ATLETAS DE FUENLABRADA · USO INTERNO</small>
              <h2>{p.title}</h2>
              <p>{p.body}</p>
              <button
                onClick={() =>
                  void navigator.share?.({
                    title: p.title,
                    text: `${p.title}\n\n${p.body}\n\nCLUB ATLETAS DE FUENLABRADA · USO INTERNO`,
                  })
                }
              >
                Compartir plan
              </button>
            </article>
          ))}
      </div>
    </>
  );
}
function Attendance({ profile }: { profile: Profile }) {
  const allGroups = useRows<Group>("training_groups");
  const assigned = useCoachGroups();
  const athletes = useRows<Athlete>("athletes", "*,training_groups(*)");
  const sessions = useRows<{
    id: string;
    training_group_id: string;
    starts_at: string;
  }>("attendance_sessions");
  const records = useRows<{
    id: string;
    session_id: string;
    athlete_id: string;
    attended: boolean | null;
  }>("attendance_records");
  const groups = ["owner", "admin"].includes(profile.role)
    ? allGroups.rows.filter((group) => group.active)
    : (assigned.rows
        .map((item) => item.training_groups)
        .filter(Boolean) as Group[]);
  const [groupId, setGroupId] = useState("");
  const [when, setWhen] = useState(new Date().toISOString().slice(0, 16));
  const [selectedSession, setSelectedSession] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const timer = window.setInterval(() => {
      void sessions.reload();
      void records.reload();
      void athletes.reload();
    }, 10000);
    return () => window.clearInterval(timer);
  }, []);
  const visibleSessions = sessions.rows.filter(
    (s) => !groupId || s.training_group_id === groupId,
  );
  const activeSession = selectedSession || visibleSessions[0]?.id || "";
  const session = sessions.rows.find((s) => s.id === activeSession);
  const roster = athletes.rows.filter(
    (a) => a.training_group_id === (session?.training_group_id || groupId),
  );
  const now = Date.now();
  const activeSessions = sessions.rows
    .filter((item) => {
      const moment = new Date(item.starts_at).getTime();
      return (
        moment <= now + 30 * 60 * 1000 && moment >= now - 2 * 60 * 60 * 1000
      );
    })
    .sort(
      (a, b) =>
        new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime(),
    );
  const createSession = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (!groupId) return setError("Selecciona un grupo.");
    const { data, error: createError } = await supabase!
      .from("attendance_sessions")
      .insert({
        training_group_id: groupId,
        starts_at: new Date(when).toISOString(),
        created_by: profile.id,
      })
      .select("id")
      .single();
    if (createError) return setError(createError.message);
    setSelectedSession(data.id);
    void sessions.reload();
  };
  const mark = async (athleteId: string, attended: boolean) => {
    if (!activeSession) return;
    setBusy(athleteId);
    const { error: markError } = await supabase!
      .from("attendance_records")
      .upsert(
        {
          session_id: activeSession,
          athlete_id: athleteId,
          attended,
          marked_by: profile.id,
          marked_at: new Date().toISOString(),
        },
        { onConflict: "session_id,athlete_id" },
      );
    if (!markError) {
      const { error: notificationError } = await supabase!.rpc(
        "queue_attendance_notification",
        {
          target_session_id: activeSession,
          target_athlete_id: athleteId,
          did_attend: attended,
        },
      );
      if (notificationError)
        setError(
          `Asistencia guardada, pero no se pudo preparar el aviso: ${notificationError.message}`,
        );
    }
    setBusy("");
    if (markError) setError(markError.message);
    else {
      void records.reload();
      if (!error) setError("");
    }
  };
  return (
    <>
      <Header
        title="Asistencia"
        text="Vista en directo: se actualiza automáticamente cada 10 segundos."
      />
      <section className="panel live-attendance">
        <div>
          <h2>Entrenamientos en pista ahora</h2>
          <p>
            {activeSessions.length
              ? "Listas abiertas en este momento. El recuento cambia según se pasa lista."
              : "No hay ninguna lista abierta ahora mismo."}
          </p>
        </div>
        <small>Actualización automática · 10 s</small>
        {activeSessions.map((item) => {
          const currentGroup = groups.find(
            (group) => group.id === item.training_group_id,
          );
          const currentRoster = athletes.rows.filter(
            (athlete) => athlete.training_group_id === item.training_group_id,
          );
          const present = records.rows.filter(
            (record) => record.session_id === item.id && record.attended,
          ).length;
          return (
            <button
              className="live-session"
              key={item.id}
              onClick={() => {
                setGroupId(item.training_group_id);
                setSelectedSession(item.id);
              }}
            >
              <span>
                <b>{currentGroup?.name || "Grupo"}</b>
                <small>
                  {new Date(item.starts_at).toLocaleTimeString("es-ES", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}{" "}
                  · {present}/{currentRoster.length} presentes
                </small>
              </span>
              <span>Ver lista →</span>
            </button>
          );
        })}
      </section>
      <form className="panel inline-form" onSubmit={createSession}>
        <label>
          Grupo
          <select
            required
            value={groupId}
            onChange={(e) => {
              setGroupId(e.target.value);
              setSelectedSession("");
            }}
          >
            <option value="">Selecciona un grupo</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Inicio del entrenamiento
          <input
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
          />
        </label>
        <button>Crear lista de hoy</button>
        {error && <p className="error-note">{error}</p>}
      </form>
      {groupId && (
        <article className="panel table">
          <div className="row">
            <span>
              <b>Sesiones del grupo</b>
              <small>Elige una lista ya creada o crea una nueva.</small>
            </span>
            <select
              value={activeSession}
              onChange={(e) => setSelectedSession(e.target.value)}
            >
              <option value="">Selecciona una sesión</option>
              {visibleSessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {new Date(s.starts_at).toLocaleString("es-ES")}
                </option>
              ))}
            </select>
          </div>
          {activeSession &&
            roster.map((a) => {
              const record = records.rows.find(
                (r) => r.session_id === activeSession && r.athlete_id === a.id,
              );
              return (
                <div className="row" key={a.id}>
                  <span>
                    <b>
                      {a.first_name} {a.last_name}
                    </b>
                    <small>{a.training_groups?.name}</small>
                  </span>
                  <span>
                    {record?.attended === true
                      ? "Asistencia confirmada"
                      : record?.attended === false
                        ? "No ha asistido"
                        : "Sin marcar"}
                  </span>
                  <span>
                    <button
                      disabled={busy === a.id}
                      onClick={() => void mark(a.id, true)}
                    >
                      Ha asistido
                    </button>{" "}
                    <button
                      className="outline"
                      disabled={busy === a.id}
                      onClick={() => void mark(a.id, false)}
                    >
                      No ha asistido
                    </button>
                  </span>
                </div>
              );
            })}
          {activeSession && !roster.length && (
            <Empty>No hay atletas asignados a este grupo.</Empty>
          )}
        </article>
      )}
      {!groups.length && <Empty>No tienes grupos asignados todavía.</Empty>}
    </>
  );
}
function Competitions({ manager = false }: { manager?: boolean }) {
  const events = useRows<{
    id: string;
    title: string;
    venue: string | null;
    starts_at: string;
    internal_deadline: string | null;
    rules_summary: string | null;
  }>("competition_events");
  return (
    <>
      <Header
        title="Carreras y competiciones"
        text="Pruebas publicadas por el club y calendario oficial de la FAM."
      >
        <a
          className="button-link"
          href={famCalendar}
          target="_blank"
          rel="noreferrer"
        >
          Calendario FAM ↗
        </a>
      </Header>
      {manager && (
        <article className="panel">
          <h2>Circulares PDF</h2>
          <p>
            La carga e interpretación se activará al conectar el almacenamiento
            privado. El entrenador validará siempre las categorías, pruebas y
            fecha interna antes de publicar.
          </p>
        </article>
      )}
      <div className="cards">
        {events.rows.map((event) => (
          <article className="panel" key={event.id}>
            <h2>{event.title}</h2>
            <p>
              {event.venue || "Ubicación pendiente"} ·{" "}
              {new Date(event.starts_at).toLocaleString("es-ES")}
            </p>
            <small>
              Fecha interna:{" "}
              {event.internal_deadline
                ? new Date(event.internal_deadline).toLocaleDateString("es-ES")
                : "por definir"}
            </small>
            {event.rules_summary && <p>{event.rules_summary}</p>}
          </article>
        ))}
        {!events.rows.length && (
          <Empty>
            No hay competiciones publicadas todavía. Consulta mientras tanto el
            calendario FAM.
          </Empty>
        )}
      </div>
    </>
  );
}
function Announcements({ profile }: { profile: Profile }) {
  const notices = useRows<{
    id: string;
    title: string;
    body: string;
    created_at: string;
    created_by: string;
  }>("announcements");
  const dismissed = useRows<{ announcement_id: string }>(
    "announcement_dismissals",
  );
  const canWrite = ["owner", "admin", "coach"].includes(profile.role);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const publish = async (e: FormEvent) => {
    e.preventDefault();
    await supabase!
      .from("announcements")
      .insert({
        title,
        body,
        audience: "club",
        created_by: profile.id,
        published_at: new Date().toISOString(),
      });
    setTitle("");
    setBody("");
    void notices.reload();
  };
  const dismiss = async (announcementId: string) => {
    if (!supabase) return;
    await supabase
      .from("announcement_dismissals")
      .upsert({ announcement_id: announcementId, profile_id: profile.id });
    void dismissed.reload();
  };
  useEffect(() => {
    if (!supabase) return;
    const incoming = notices.rows
      .filter(
        (item) =>
          item.created_by !== profile.id &&
          !dismissed.rows.some((hidden) => hidden.announcement_id === item.id),
      )
      .map((item) => ({
        announcement_id: item.id,
        profile_id: profile.id,
        read_at: new Date().toISOString(),
      }));
    if (incoming.length)
      void supabase
        .from("announcement_reads")
        .upsert(incoming, { onConflict: "announcement_id,profile_id" });
  }, [notices.rows.length, dismissed.rows.length, profile.id]);
  const visible = notices.rows.filter(
    (item) =>
      !dismissed.rows.some((hidden) => hidden.announcement_id === item.id),
  );
  return (
    <>
      <Header title="Avisos" text="Comunicaciones del club." />
      {canWrite && (
        <form className="panel stacked-form" onSubmit={publish}>
          <label>
            Asunto
            <input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label>
            Mensaje
            <textarea
              required
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </label>
          <button>Publicar aviso</button>
        </form>
      )}
      <div className="cards">
        {visible.map((n) => (
          <article className="panel" key={n.id}>
            <h2>{n.title}</h2>
            <p>{n.body}</p>
            <small>{new Date(n.created_at).toLocaleString("es-ES")}</small>
            <button className="outline" onClick={() => void dismiss(n.id)}>
              Quitar de mi lista
            </button>
          </article>
        ))}
        {!visible.length && <Empty>No hay avisos publicados.</Empty>}
      </div>
    </>
  );
}
function Member({
  section,
  profile,
  go,
  openAthlete,
  focusedAthleteId,
}: {
  section: string;
  profile: Profile;
  go: (section: string) => void;
  openAthlete: (id: string) => void;
  focusedAthleteId: string;
}) {
  if (profile.role === "minor_athlete" && ["Cuotas", "Tienda", "Mis atletas", "Mis menores"].includes(section))
    return <><Header title="Acceso deportivo" text="Este perfil muestra únicamente la información deportiva del atleta." /><article className="panel"><h2>Sección reservada a la familia</h2><p>Las cuotas, compras y gestiones familiares solo están disponibles en la cuenta del padre, madre o tutor.</p></article></>;
  if (section === "Inicio" && profile.role === "parent")
    return <FamilyHome profile={profile} go={go} openAthlete={openAthlete} />;
  if (section === "Mis atletas" && profile.role === "parent")
    return <FamilyAthletes initialAthleteId={focusedAthleteId} />;
  if (section === "Mis menores" && profile.role !== "minor_athlete")
    return <FamilyAthletes initialAthleteId={focusedAthleteId} dependentsOnly />;
  if (section === "Carreras") return <CompetitionManager profile={profile} />;
  if (section === "Cuotas") return <Fees profile={profile} />;
  if (section === "Avisos" && profile.role === "parent")
    return <FamilyNotices profileId={profile.id} />;
  if (section === "Avisos") return <Announcements profile={profile} />;
  if (section === "Tienda") return <Shop profile={profile} />;
  const athletes = useRows<Athlete>("athletes", "*,training_groups(*)");
  const mine = athletes.rows.filter((a) => a.user_profile_id === profile.id);
  return (
    <>
      <Header
        title={section === "Mi perfil" ? "Mi perfil" : "Mis atletas"}
        text="Estado de alta, grupo y licencia."
      />
      <div className="cards">
        {mine.map((a) => (
          <article className="panel" key={a.id}>
            <h2>
              {a.first_name} {a.last_name}
            </h2>
            <p>{a.training_groups?.name || "Grupo pendiente de asignación"}</p>
            <small>
              Estado: {a.club_status === "active" ? "Activo" : "En revisión"} ·
              Licencia:{" "}
              {a.license_status === "active"
                ? a.license_number || "activa"
                : "pendiente"}
            </small>
          </article>
        ))}
        {!mine.length && (
          <Empty>
            Tu inscripción está pendiente de revisión administrativa.
          </Empty>
        )}
      </div>
    </>
  );
}
function Settings() {
  const [form, setForm] = useState({
    club_name: "Club Atletas de Fuenlabrada",
    contact_email: "",
    registration_notification_email: "info@atletasdefuenlabrada.com",
    contact_phone: "",
    address_line: "",
    season_label: "Temporada 2026/27",
    registration_open: false,
    registration_message: "",
    logo_url: "",
  });
  const [logo, setLogo] = useState<File | null>(null);
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [stravaNotice, setStravaNotice] = useState("");
  const [stravaBusy, setStravaBusy] = useState(false);
  useEffect(() => {
    const load = async () => {
      if (!supabase) return;
      const { data, error } = await supabase
        .from("club_settings")
        .select("*")
        .eq("id", true)
        .maybeSingle();
      if (error) return setNotice(error.message);
      if (data)
        setForm({
          club_name: data.club_name || "Club Atletas de Fuenlabrada",
          contact_email: data.contact_email || "",
          registration_notification_email:
            data.registration_notification_email ||
            data.contact_email ||
            "info@atletasdefuenlabrada.com",
          contact_phone: data.contact_phone || "",
          address_line: data.address_line || "",
          season_label: data.season_label || "Temporada 2026/27",
          registration_open: data.registration_open,
          registration_message: data.registration_message || "",
          logo_url: data.logo_url || "",
        });
    };
    void load();
  }, []);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setSaving(true);
    setNotice("");
    try {
      let logoUrl = form.logo_url || null;
      if (logo) {
        if (!logo.type.startsWith("image/"))
          throw new Error("Selecciona una imagen válida para el escudo.");
        const key = `branding/${Date.now()}-${logo.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
        const { error } = await supabase.storage
          .from("club-assets")
          .upload(key, logo, { contentType: logo.type });
        if (error) throw error;
        logoUrl = supabase.storage.from("club-assets").getPublicUrl(key)
          .data.publicUrl;
      }
      const { error } = await supabase
        .from("club_settings")
        .update({
          ...form,
          logo_url: logoUrl,
          updated_at: new Date().toISOString(),
        })
        .eq("id", true);
      if (error) throw error;
      setForm({ ...form, logo_url: logoUrl || "" });
      setLogo(null);
      setNotice(
        "Configuración guardada. La identidad nueva se aplicará al recargar la aplicación.",
      );
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "No se pudo guardar la configuración.",
      );
    } finally {
      setSaving(false);
    }
  };
  const setupStravaWebhook = async () => {
    if (!supabase) return;
    setStravaBusy(true);
    setStravaNotice("");
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session)
        throw new Error("La sesión ha caducado. Vuelve a iniciar sesión.");
      const response = await fetch("/api/strava-webhook-setup", {
        method: "POST",
        headers: { authorization: `Bearer ${data.session.access_token}` },
      });
      const result = (await response.json().catch(() => null)) as {
        ok?: boolean;
        existing?: unknown[];
        error?: string;
      } | null;
      if (!response.ok || !result?.ok)
        throw new Error(result?.error || "No se pudo comprobar Strava.");
      setStravaNotice(
        result.existing?.length
          ? "Strava está conectado y su webhook ya estaba activo."
          : "Strava está conectado y su webhook acaba de quedar activo.",
      );
    } catch (error) {
      setStravaNotice(
        error instanceof Error ? error.message : "No se pudo comprobar Strava.",
      );
    } finally {
      setStravaBusy(false);
    }
  };
  return (
    <>
      <Header
        title="Centro de configuración"
        text="Identidad, temporada, contacto y apertura de inscripciones del club."
      />
      <form className="settings-workspace" onSubmit={save}>
        <article className="panel settings-brand">
          <div>
            {form.logo_url ? (
              <img src={form.logo_url} alt="Escudo del club" />
            ) : (
              <b>AF</b>
            )}
          </div>
          <section>
            <small>IDENTIDAD DEL CLUB</small>
            <h2>{form.club_name}</h2>
            <label>
              Escudo o logotipo
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setLogo(e.target.files?.[0] || null)}
              />
            </label>
            <small>
              {logo
                ? logo.name
                : "PNG, JPG o WEBP. El archivo se guarda en el almacenamiento privado del club."}
            </small>
          </section>
        </article>
        <article className="panel">
          <h2>Datos visibles del club</h2>
          <div className="ops-grid">
            <label>
              Nombre del club
              <input
                required
                value={form.club_name}
                onChange={(e) =>
                  setForm({ ...form, club_name: e.target.value })
                }
              />
            </label>
            <label>
              Temporada activa
              <input
                required
                value={form.season_label}
                onChange={(e) =>
                  setForm({ ...form, season_label: e.target.value })
                }
              />
            </label>
            <label>
              Email de contacto
              <input
                type="email"
                value={form.contact_email}
                onChange={(e) =>
                  setForm({ ...form, contact_email: e.target.value })
                }
                placeholder="info@club…"
              />
            </label>
            <label>
              Teléfono de contacto
              <input
                value={form.contact_phone}
                onChange={(e) =>
                  setForm({ ...form, contact_phone: e.target.value })
                }
              />
            </label>
            <label>
              Dirección o instalación
              <input
                value={form.address_line}
                onChange={(e) =>
                  setForm({ ...form, address_line: e.target.value })
                }
                placeholder="Estadio Raúl González, URJC"
              />
            </label>
          </div>
        </article>
        <article className="panel">
          <h2>Inscripciones</h2>
          <label className="check-line">
            <input
              type="checkbox"
              checked={form.registration_open}
              onChange={(e) =>
                setForm({ ...form, registration_open: e.target.checked })
              }
            />
            Permitir nuevas inscripciones desde la página pública
          </label>
          <label>
            Mensaje para familias
            <textarea
              value={form.registration_message}
              onChange={(e) =>
                setForm({ ...form, registration_message: e.target.value })
              }
              placeholder="Las altas se revisan antes de quedar activas."
            />
          </label>
        </article>
        <article className="panel settings-status">
          <h2>Operativa y seguridad</h2>
          <p>
            <b>Pagos:</b> Stripe/TPV se configura con claves seguras en
            Cloudflare; nunca en esta pantalla.
          </p>
          <p>
            <b>Equipo:</b> los administradores y entrenadores se gestionan desde
            Invitaciones y Grupos.
          </p>
          <p>
            <b>Normativas:</b> se muestran dentro de la inscripción antes de que
            la familia las acepte.
          </p>
          <p>
            <b>Strava:</b> comprueba aquí la conexión técnica que recibe las
            actividades del club.
          </p>
          <button
            type="button"
            className="outline"
            disabled={stravaBusy}
            onClick={() => void setupStravaWebhook()}
          >
            {stravaBusy
              ? "Comprobando Strava…"
              : "Comprobar conexión de Strava"}
          </button>
          {stravaNotice && (
            <p
              className={
                stravaNotice.startsWith("Strava está")
                  ? "success-note"
                  : "error-note"
              }
            >
              {stravaNotice}
            </p>
          )}
        </article>
        <button disabled={saving}>
          {saving ? "Guardando…" : "Guardar configuración del club"}
        </button>
        {notice && (
          <p
            className={
              notice.startsWith("Configuración")
                ? "success-note panel"
                : "error-note panel"
            }
          >
            {notice}
          </p>
        )}
      </form>
      <article className="panel dependents-access-card">
        <small>CUENTA PERSONAL · FAMILIA</small>
        <h2>Personas a mi cargo</h2>
        <p>
          Este acceso es personal: permite añadir menores a tu propia cuenta sin
          afectar a tus permisos de administración.
        </p>
        <button
          type="button"
          onClick={() =>
            window.location.assign(
              `/?section=${encodeURIComponent("Mis menores")}`,
            )
          }
        >
          Gestionar personas a mi cargo →
        </button>
      </article>
    </>
  );
}
