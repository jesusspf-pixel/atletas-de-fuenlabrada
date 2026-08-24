import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
type Notice = { id: string; title: string; body: string; created_at: string };
export default function FamilyNotices({ profileId }: { profileId: string }) {
  const [items, setItems] = useState<Notice[]>([]); const [hidden, setHidden] = useState<string[]>([]);
  const load = async () => { if (!supabase) return; const [{ data }, { data: dismissed }] = await Promise.all([supabase.from("announcements").select("id,title,body,created_at").order("created_at", { ascending: false }), supabase.from("announcement_dismissals").select("announcement_id").eq("profile_id", profileId)]); setItems((data ?? []) as Notice[]); setHidden((dismissed ?? []).map(x => x.announcement_id)); };
  useEffect(() => { void load(); }, [profileId]);
  const visible = items.filter(item => !hidden.includes(item.id) && !item.title.startsWith("Asistencia:"));
  const remove = async (id: string) => { if (!supabase) return; await supabase.from("announcement_dismissals").upsert({ announcement_id: id, profile_id: profileId }); setHidden([...hidden, id]); };
  return <><div className="page-head"><div><h1>Avisos</h1><p>Comunicaciones importantes del club.</p></div></div><section className="cards">{visible.map(item => <article className="panel" key={item.id}><h2>{item.title}</h2><p>{item.body}</p><small>{new Date(item.created_at).toLocaleString("es-ES")}</small><button className="outline" onClick={() => void remove(item.id)}>Quitar de mi lista</button></article>)}{!visible.length && <article className="panel"><p>No hay comunicaciones del club.</p></article>}</section></>;
}
