export const trainingSeasonYear = (today = new Date()) => today.getFullYear() + (today.getMonth() >= 6 ? 1 : 0);

export const categoryForBirthYear = (birthYear: number, seasonYear = trainingSeasonYear()) => {
  const age = seasonYear - birthYear;
  if (age <= 5) return "Sub 6";
  if (age <= 7) return "Sub 8";
  if (age <= 9) return "Sub 10";
  if (age <= 11) return "Sub 12";
  if (age <= 13) return "Sub 14";
  if (age <= 15) return "Sub 16";
  if (age <= 17) return "Sub 18";
  if (age <= 19) return "Sub 20";
  if (age <= 22) return "Sub 23";
  return "Absoluto / Máster";
};

export const trainingCategory = (birthDate: string, seasonYear = trainingSeasonYear()) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return "";
  return categoryForBirthYear(Number(birthDate.slice(0, 4)), seasonYear);
};

export const birthYearsFor2027: Record<string, string> = {
  "Sub-6": "2022–2023",
  "Sub-8": "2020–2021",
  "Sub-10": "2018–2019",
  "Sub-12": "2016–2017",
  "Sub-14": "2014–2015",
  "Sub-16": "2012–2013",
  "Sub-18": "2010–2011",
  "Sub-20": "2008–2009",
  "Sub-23": "2005–2007",
  Absoluto: "1993–2004",
  Máster: "1992 o anteriores",
};
