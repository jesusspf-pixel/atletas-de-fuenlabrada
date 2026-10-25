import type { SupabaseClient } from "@supabase/supabase-js";

export type AthleteAccessRow = {
  club_status: string;
  family_id?: string | null;
  access_via_additional_guardian?: boolean;
};

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

  const primaryFamilyIds = (primaryFamilies || []).map((item) => item.id);
  const guardianFamilyIds = (guardianLinks || []).map((item) => item.family_id);
  const familyIds = [
    ...primaryFamilyIds,
    ...guardianFamilyIds,
  ].filter((id, index, all): id is string => Boolean(id) && all.indexOf(id) === index);

  if (!familyIds.length) return [];
  const { data: athletes } = await client
    .from("athletes")
    .select("club_status,family_id")
    .in("family_id", familyIds);
  return ((athletes || []) as AthleteAccessRow[]).map((athlete) => ({
    ...athlete,
    access_via_additional_guardian:
      Boolean(athlete.family_id) &&
      guardianFamilyIds.includes(athlete.family_id as string) &&
      !primaryFamilyIds.includes(athlete.family_id as string),
  }));
}
