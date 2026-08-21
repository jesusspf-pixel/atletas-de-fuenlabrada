import { ChangeEvent, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

type Settings = { athlete_id: string; avatar_url: string | null; cover_url: string | null; bio: string | null; challenge_opt_in: boolean; show_activity_to_club: boolean };

const maxBytes = 2 * 1024 * 1024;
const fields = "athlete_id,avatar_url,cover_url,bio,challenge_opt_in,show_activity_to_club";

export default function AthleteProfileEditor({ athleteId, canEdit }: { athleteId: string; canEdit: boolean }) {
  const [settings, setSettings] = useState<Settings>({ athlete_id: athleteId, avatar_url: null, cover_url: null, bio: "", challenge_opt_in: false, show_activity_to_club: false });
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const client = supabase; if (!client) return;
    const { data, error } = await client.from("athlete_profile_settings").select(fields).eq("athlete_id", athleteId).maybeSingle();
    if (error) return setNotice(error.message);
    if (data) setSettings(data as Settings);
  };
  useEffect(() => { void load(); }, [athleteId]);

  const save = async (patch: Partial<Settings>) => {
    const client = supabase; if (!client || !canEdit) return;
    setBusy(true); setNotice("");
    const next = { ...settings, ...patch, athlete_id: athleteId };
    const { data, error } = await client.from("athlete_profile_settings").upsert(next, { onConflict: "athlete_id" }).select(fields).single();
    setBusy(false);
    if (error) return setNotice(error.message);
    if (data) setSettings(data as Settings);
    setNotice("Perfil actualizado.");
  };

  const upload = async (event: ChangeEvent<HTMLInputElement>, kind: "avatar" | "cover") => {
    const client = supabase; const file = event.target.files?.[0]; if (!client || !file || !canEdit) return;
    if (file.size > maxBytes) return setNotice("La imagen debe pesar menos de 2 MB.");
    if (!file.type.startsWith("image/")) return setNotice("Selecciona una imagen válida.");
    setBusy(true); setNotice("");
    const { data: sessionData } = await client.auth.getSession();
    const userId = sessionData.session?.user.id; if (!userId) { setBusy(false); return setNotice("Tu sesión ha caducado. Vuelve a iniciar sesión."); }
    const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const path = `${userId}/${athleteId}/${kind}-${Date.now()}.${ext}`;
    const { error: uploadError } = await client.storage.from("athlete-profiles").upload(path, file, { upsert: true, contentType: file.type });
    if (uploadError) { setBusy(false); return setNotice(uploadError.message); }
    const { data: publicData } = client.storage.from("athlete-profiles").getPublicUrl(path);
    const imagePatch = kind === "avatar" ? { avatar_url: publicData.publicUrl } : { cover_url: publicData.publicUrl };
    const next = { ...settings, ...imagePatch, athlete_id: athleteId };
    const { data, error } = await client.from("athlete_profile_settings").upsert(next, { onConflict: "athlete_id" }).select(fields).single();
    setBusy(false);
    if (error) return setNotice(error.message);
    if (data) setSettings(data as Settings);
    event.target.value = "";
    setNotice(kind === "avatar" ? "Foto de perfil guardada." : "Imagen de portada guardada.");
  };

  const success = notice === "Perfil actualizado." || notice === "Foto de perfil guardada." || notice === "Imagen de portada guardada.";

  return <article className="panel athlete-profile-card">
    <div className="athlete-cover" style={settings.cover_url ? { backgroundImage: `url(${settings.cover_url})` } : undefined}>
      {settings.avatar_url ? <img className="athlete-avatar" src={settings.avatar_url} alt="Foto de perfil del atleta" /> : <div className="athlete-avatar athlete-avatar-placeholder">AF</div>}
    </div>
    {settings.bio && <p className="athlete-bio">{settings.bio}</p>}
    {canEdit && <div className="stacked-form"><h2>Personaliza tu ficha</h2><label>Foto de perfil<input type="file" accept="image/*" disabled={busy} onChange={event => void upload(event, "avatar")} /></label><label>Imagen de portada<input type="file" accept="image/*" disabled={busy} onChange={event => void upload(event, "cover")} /></label><label>Presentación<textarea maxLength={280} value={settings.bio || ""} onChange={event => setSettings(current => ({ ...current, bio: event.target.value }))} placeholder="Cuéntanos algo sobre ti como atleta…" /></label><label className="check-line"><input type="checkbox" checked={settings.challenge_opt_in} onChange={event => setSettings(current => ({ ...current, challenge_opt_in: event.target.checked, show_activity_to_club: event.target.checked ? current.show_activity_to_club : false }))} />Participar en Club Challenge</label><label className="check-line"><input type="checkbox" disabled={!settings.challenge_opt_in} checked={settings.show_activity_to_club} onChange={event => setSettings(current => ({ ...current, show_activity_to_club: event.target.checked }))} />Compartir mis estadísticas de actividad con el club</label><small>Las fotos se guardan al seleccionarlas. Usa Guardar cambios para la presentación y las preferencias del Challenge.</small><button type="button" disabled={busy} onClick={() => void save(settings)}>{busy ? "Guardando…" : "Guardar cambios"}</button></div>}
    {notice && <p className={success ? "success-note" : "error-note"}>{notice}</p>}
  </article>;
}
