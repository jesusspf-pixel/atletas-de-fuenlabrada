export type RegistrationAthlete = { birth_date: string | null; federative_sex: string | null };
export type RegistrationEvent = { starts_at: string; internal_deadline: string | null; published: boolean };
export type RegistrationTest = { active: boolean; eligible_categories: string[]; eligible_sex: string; min_birth_year: number | null; max_birth_year: number | null };
export const competitionCategory = (athlete: RegistrationAthlete, event: Pick<RegistrationEvent, "starts_at">) => {
  if (!athlete.birth_date) return "";
  const age = Number(event.starts_at.slice(0, 4)) - Number(athlete.birth_date.slice(0, 4));
  if (!Number.isFinite(age) || age < 0) return "";
  for (const limit of [6, 8, 10, 12, 14, 16, 18, 20, 23]) if (age < limit) return `Sub ${limit}`;
  return "Absoluto / Máster";
};
export const competitionClosed = (event: RegistrationEvent, now = Date.now()) =>
  !event.published || Date.parse(event.starts_at) <= now || Boolean(event.internal_deadline && Date.parse(event.internal_deadline) <= now);
export const eligibleCompetitionTest = (test: RegistrationTest, athlete: RegistrationAthlete, event: Pick<RegistrationEvent, "starts_at">) => {
  if (!test.active || !athlete.birth_date) return false;
  const year = Number(athlete.birth_date.slice(0, 4));
  const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");
  const category = competitionCategory(athlete, event);
  const sex = (athlete.federative_sex || "").toLowerCase();
  return Boolean(category) && (!test.eligible_categories.length || test.eligible_categories.some(c => normalize(c) === normalize(category))) &&
    (test.min_birth_year == null || year >= test.min_birth_year) && (test.max_birth_year == null || year <= test.max_birth_year) &&
    (test.eligible_sex === "all" || (test.eligible_sex === "female" && ["f", "female", "femenino", "mujer"].includes(sex)) || (test.eligible_sex === "male" && ["m", "male", "masculino", "hombre"].includes(sex)));
};
export const competitionEntryLabel: Record<string, string> = {
  requested: "Solicitud recibida · pendiente de revisión", reviewing: "Solicitud en revisión", approved: "Solicitud aprobada por el club", rejected: "Solicitud rechazada", registered: "Inscripción confirmada",
};
