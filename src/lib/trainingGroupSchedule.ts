type TrainingGroupSchedule = {
  name: string;
  category_label: string;
  schedule_days?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
};

export function withOfficialTrainingSchedule<T extends TrainingGroupSchedule>(group: T): T {
  const identity = `${group.name} ${group.category_label}`.toLowerCase();
  if (!/sub\s*[- ]?14/.test(identity)) return group;

  return {
    ...group,
    schedule_days: "Lunes a jueves",
    starts_at: "19:00",
    ends_at: "20:00",
  };
}

export function withOfficialTrainingSchedules<T extends TrainingGroupSchedule>(groups: T[]): T[] {
  return groups.map(withOfficialTrainingSchedule);
}
