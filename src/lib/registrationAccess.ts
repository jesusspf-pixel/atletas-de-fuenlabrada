import type { SupabaseClient } from "@supabase/supabase-js";

export type AthleteAccessRow = { club_status: string };

export async function loadParentAthleteStatuses(
  client: SupabaseClient,
  profileId: string,
): Promise<AthleteAccessRow[]> {
  const [{ data: primaryFamilies }, { data: guardianLinks }] = await Promise.all([
    client.from("families").select("id").eq("primary_profile_id", profileId),
    client
      .from("family_guardians")
      .select("family_id")
      .eq("profile_id", profileId)
      .eq("access_status", "active"),
  ]);

  const familyIds = [
    ...(primaryFamilies || []).map((item) => item.id),
    ...(guardianLinks || []).map((item) => item.family_id),
  ].filter((id, index, all): id is string => Boolean(id) && all.indexOf(id) === index);

  if (!familyIds.length) return [];
  const { data: athletes } = await client
    .from("athletes")
    .select("club_status")
    .in("family_id", familyIds);
  return (athletes || []) as AthleteAccessRow[];
}
