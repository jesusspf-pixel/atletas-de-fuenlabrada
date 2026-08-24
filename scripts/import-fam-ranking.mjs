#!/usr/bin/env node
/**
 * Conservative parser for the official FAM annual ranking PDF converted with
 * `pdftotext -layout`. It only emits complete standard result rows; relay
 * continuation lines are intentionally left for a dedicated parser so that no
 * historical result is published with shifted fields.
 */
import fs from 'node:fs';

const [,, input, output] = process.argv;
if (!input || !output) {
  console.error('Uso: node fam_rank_parser.mjs ranking.txt resultados.json');
  process.exit(1);
}

const accepted = /(?:CLUB DEPORTIVO B[ÁA]SICO ATLETAS DE FUENLABRADA|ATLETAS DE FUENLABRADA|ATLETISMO URJC FUENLABRADA|URJC FUENLABRADA)/i;
const rejected = /^(?:CLUB (?:DE )?ATLETISMO FUENLABRADA)$/i;
const dateRx = /\b(\d{1,2}\/\d{1,2}\/\d{4})\b/g;
const categoryRx = /\b(U(?:8|10|12|14|16|18|20|23)[MF]|S[MF]|M\d\d[MF])\b/;
const licenceRx = /\b(M(?:-\d+(?:-A-T-s)?|\d+))\b/;

function isoDate(value) {
  const [day, month, year] = value.split('/');
  return `${year}-${month.padStart(2,'0')}-${day.padStart(2,'0')}`;
}

function clean(value) { return value.replace(/\s+/g, ' ').trim(); }
function normalizeMark(value) { return value.replace(',', '.').replace(/\s+/g, ''); }
function valueAndUnit(mark, event) {
  const normalized = normalizeMark(mark);
  const seconds = /^(\d+):(\d{2})(?:\.(\d+))?$/.exec(normalized);
  if (seconds) return { value: Number(seconds[1])*60+Number(seconds[2])+Number(`0.${seconds[3]||0}`), unit: 's' };
  const n = Number(normalized);
  if (!Number.isFinite(n)) return { value: null, unit: null };
  const isTime = /^\d+(?:[.,]\d+)?m\b/i.test(event) || /(?:vallas|obst[aá]culos|relevos|march)/i.test(event);
  return { value: n, unit: isTime ? 's' : 'm' };
}
function eventKey(label) {
  return clean(label)
    .replace(/\s+(?:ABSOLUT[AO]|SUB\s?\d+|M[ÁA]STER|U\d+).*$/i, '')
    .replace(/\s+pc\.\s+\d{4}$/i, '')
    .trim();
}

const rows=[];
let currentEvent='';
let skipped=0;
const skippedReasons={};
function skip(reason) { skipped++; skippedReasons[reason]=(skippedReasons[reason]||0)+1; }
for (const raw of fs.readFileSync(input,'utf8').split(/\r?\n/)) {
  const line=clean(raw);
  if (!line) continue;
  // Annual ranking headers always finish in the season year and do not start
  // with a numeric ranking position.
  if (!/^\d+\s/.test(line)
      && /\b(?:Absoluta|Sub\s?\d+|M[ÁA]ster)\b/i.test(line)
      && /\b20\d{2}$/.test(line)
      && !/\d{1,2}\/\d{1,2}\/20\d{2}/.test(line)
      && !/RANKING MADRID/i.test(line)) {
    currentEvent=eventKey(line);
    continue;
  }
  if (!currentEvent || !accepted.test(line) || rejected.test(line)) continue;
  const dates=[...line.matchAll(dateRx)];
  const licence=line.match(licenceRx);
  const category=line.match(categoryRx);
  const position=/^(\d+)\s+/.exec(line);
  if (!position || !dates.length || !licence || !category) { skip('missing standard fields'); continue; }
  const birth=dates[0][1];
  const competition=dates.at(-1)[1];
  const birthIndex=line.indexOf(birth);
  const beforeBirth=line.slice(0,birthIndex).trim();
  const clubMatch=beforeBirth.match(/(.*?)(CLUB DEPORTIVO B[ÁA]SICO ATLETAS DE FUENLABRADA|ATLETISMO URJC FUENLABRADA|URJC FUENLABRADA|ATLETAS DE FUENLABRADA)\s*$/i);
  if (!clubMatch) { skip('club split'); continue; }
  const beforeClub=clubMatch[1].trim();
  const standard=/^(\d+)\s+([^\s]+)(?:\s+[-+]?\d+[,.]\d+)?\s+(.+)$/.exec(beforeClub);
  if (!standard) { skip('standard row'); continue; }
  const [, rank, mark, athleteName]=standard;
  const afterBirth=line.slice(birthIndex+birth.length);
  const licenceIndex=afterBirth.indexOf(licence[0]);
  const categoryIndex=afterBirth.indexOf(category[0]);
  const venue=clean(afterBirth.slice(categoryIndex+category[0].length, afterBirth.lastIndexOf(competition)));
  const parsed=valueAndUnit(mark,currentEvent);
  if (parsed.value===null) { skip('mark'); continue; }
  rows.push({
    external_row_id:`fam-2025-${currentEvent}-${rank}-${licence[1]}-${competition}`,
    athlete_name:clean(athleteName), federation_license:licence[1],
    club_name:clean(clubMatch[2]), event_name:currentEvent,
    result_text:mark, result_value:parsed.value, result_unit:parsed.unit,
    position:Number(rank), category_label:category[1],
    competition_date:isoDate(competition), birth_date:isoDate(birth), venue,
    raw_line:line
  });
}
const unique=[...new Map(rows.map(r=>[r.external_row_id,r])).values()];
fs.writeFileSync(output, JSON.stringify({source:'FAM Ranking Madrid 2025', rows:unique, skipped, skippedReasons},null,2));
console.log(JSON.stringify({parsed:unique.length, skipped, skippedReasons, samples:unique.slice(0,3)},null,2));
