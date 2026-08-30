import { ChangeEvent, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

type Settings = { athlete_id: string; avatar_url: string | null; cover_url: string | null; bio: string | null; challenge_opt_in: boolean; show_activity_to_club: boolean };

const maxBytes = 5 * 1024 * 1024;

export default function AthleteProfileEditor({ athleteId, canEdit }: { athleteId: string; canEdit: boolean }) {
  const [settings, setSettings] = useState<Settings>({ athlete_id: athleteId, avatar_url: null, cover_url: null, bio: "", challenge_opt_in: false, show_activity_to_club: false });
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);

  const notifyHeader = (next: Settings) => window.dispatchEvent(new CustomEvent("athlete-profile-updated", { detail: next }));

  const load = async () => {
    const client = supabase; if (!client) return;
    const { data, error } = await client.from("athlete_profile_settings").select("athlete_id,avatar_url,cover_url,bio,challenge_opt_in,show_activity_to_club").eq("athlete_id", athleteId).maybeSingle();
    if (error) return setNotice(`No se pudo cargar la ficha: ${error.message}`);
    if (data) {
      const next = data as Settings;
      setSettings(next);
      setEditing(!next.avatar_url);
      notifyHeader(next);
    } else {
      setEditing(true);
    }
  };
  useEffect(() => { void load(); }, [athleteId]);

  const save = async (patch: Partial<Settings>) => {
    const client = supabase; if (!client || !canEdit) return;
    setBusy(true); setNotice("");
    const next: Settings = { ...settings, ...patch, athlete_id: athleteId };
    const { error } = await client.from("athlete_profile_settings").upsert(next, { onConflict: "athlete_id" });
    setBusy(false);
    if (error) return setNotice(`No se pudo guardar la ficha: ${error.message}`);
    setSettings(next); notifyHeader(next); setNotice("Perfil actualizado.");
    if (next.avatar_url) setEditing(false);
  };

  const uploadAvatar = async (event: ChangeEvent<HTMLInputElement>) => {
    const client = supabase; const file = event.target.files?.[0]; if (!client || !file || !canEdit) return;
    if (file.size > maxBytes) return setNotice("La imagen es demasiado grande. El máximo es 5 MB.");
    if (!["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"].includes(file.type)) return setNotice("Selecciona una imagen JPG, PNG, WEBP, HEIC o HEIF.");
    setBusy(true); setNotice("Subiendo foto de perfil…");
    const { data: sessionData } = await client.auth.getSession();
    const userId = sessionData.session?.user.id; if (!userId) { setBusy(false); return setNotice("Tu sesión ha caducado. Vuelve a iniciar sesión."); }
    const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const path = `${userId}/${athleteId}/avatar-${Date.now()}.${ext}`;
    const { error: uploadError } = await client.storage.from("athlete-profiles").upload(path, file, { upsert: true, contentType: file.type });
    if (uploadError) { setBusy(false); return setNotice(`No se pudo subir la imagen: ${uploadError.message}`); }
    const { data } = client.storage.from("athlete-profiles").getPublicUrl(path);
    const nextSettings: Settings = { ...settings, athlete_id: athleteId, avatar_url: data.publicUrl, cover_url: null };
    const { data: saved, error: saveError } = await client.from("athlete_profile_settings").upsert(nextSettings, { onConflict: "athlete_id" }).select("athlete_id,avatar_url,cover_url,bio,challenge_opt_in,show_activity_to_club").single();
    setBusy(false);
    if (saveError) return setNotice(`La imagen subió, pero no se pudo vincular a tu ficha: ${saveError.message}`);
    const persisted = (saved as Settings) || nextSettings;
    setSettings(persisted); notifyHeader(persisted);
    event.target.value = "";
    setNotice("Foto de perfil guardada y vinculada a tu ficha.");
  };

  const success = notice === "Perfil actualizado." || notice.includes("guardada y vinculada");
  const showLocalPreview = window.location.pathname === "/deportivo";

  return <article className="panel athlete-profile-card">
    {showLocalPreview && <div className="athlete-cover athlete-cover-club">
      {settings.avatar_url ? <img className="athlete-avatar" src={settings.avatar_url} alt="Foto de perfil del atleta" onError={() => setNotice("La foto está guardada, pero el navegador no puede mostrar este formato. Prueba con JPG, PNG o WebP.")} /> : <div className="athlete-avatar athlete-avatar-placeholder">AF</div>}
    </div>}
    {settings.bio && <p className="athlete-bio">{settings.bio}</p>}
    {canEdit && !editing && <div className="profile-editor-collapsed"><button type="button" className="outline" onClick={() => setEditing(true)}>Editar foto de perfil</button></div>}
    {canEdit && editing && <div className="stacked-form"><div className="table-title"><h2>Personaliza tu ficha</h2>{settings.avatar_url && <button type="button" className="plain" onClick={() => setEditing(false)}>Cerrar edición</button>}</div><label>Foto de perfil<input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" disabled={busy} onChange={event => void uploadAvatar(event)} /></label>{notice && <p className={success ? "success-note" : "error-note"}>{notice}</p>}<label>Presentación<textarea maxLength={280} value={settings.bio || ""} onChange={event => setSettings(current => ({ ...current, bio: event.target.value }))} placeholder="Cuéntanos algo sobre ti como atleta…" /></label><label className="check-line"><input type="checkbox" checked={settings.challenge_opt_in} onChange={event => setSettings(current => ({ ...current, challenge_opt_in: event.target.checked, show_activity_to_club: event.target.checked ? current.show_activity_to_club : false }))} />Participar en Club Challenge</label><label className="check-line"><input type="checkbox" disabled={!settings.challenge_opt_in} checked={settings.show_activity_to_club} onChange={event => setSettings(current => ({ ...current, show_activity_to_club: event.target.checked }))} />Compartir mis estadísticas de actividad con el club</label><small>La foto se guarda al seleccionarla y será tu imagen en Challenge, comunicaciones y grupos. El fondo utiliza siempre la identidad oficial del club.</small><button type="button" disabled={busy} onClick={() => void save({ ...settings, cover_url: null })}>{busy ? "Guardando…" : "Guardar cambios"}</button></div>}
    {!canEdit && notice && <p className={success ? "success-note" : "error-note"}>{notice}</p>}
  </article>;
}
