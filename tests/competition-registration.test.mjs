import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { competitionCategory, competitionClosed, eligibleCompetitionTest } from '../src/lib/competitionRegistration.ts';
const code = buildSync({ entryPoints: ['functions/api/competition-registration.ts'], bundle: true, platform: 'node', format: 'esm', write: false }).outputFiles[0].text;
const { onRequest } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const aid = '11111111-1111-4111-8111-111111111111', eid = '22222222-2222-4222-8222-222222222222', tid = '33333333-3333-4333-8333-333333333333';
const event = { id: eid, title: 'Carrera de prueba', starts_at: '2099-11-01T10:00:00Z', published: true, internal_deadline: null, created_by: 'publisher' };
const athlete = { id: aid, family_id: 'family', user_profile_id: null, first_name: 'Atleta', last_name: 'Prueba', birth_date: '2090-01-01', federative_sex: 'F' };
const compatible = { id: tid, name: '60 m', active: true, eligible_categories: ['Sub-10'], eligible_sex: 'female', min_birth_year: 2089, max_birth_year: 2090 };
const entry = { id: 'entry', competition_event_id: eid, athlete_id: aid, requested_events: [], status: 'requested', notes: null };
async function run(options = {}) {
  const calls = [], writes = []; let saved = options.existing || null;
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url); const table = u.pathname.split('/').at(-1); calls.push({ table, query: u.searchParams, init });
    if (table === 'user') return Response.json({ id: 'caller' }, { status: options.authStatus || 200 });
    if (init.method === 'POST') {
      const body = JSON.parse(init.body); writes.push({ table, body });
      if (table === 'competition_entries') {
        if (options.insertFails) return Response.json({}, { status: 500 });
        saved = { ...entry, requested_events: body.requested_events }; return Response.json(options.race ? [] : [saved]);
      }
      if (table === 'announcements') return Response.json(options.notificationFails ? {} : [{ id: 'announcement' }], { status: options.notificationFails ? 500 : 200 });
      if (table === 'announcement_deliveries') return new Response(null, { status: 201 });
      throw new Error(`Unexpected write ${table}`);
    }
    if (table === 'families') return Response.json(options.primary ? [{ id: 'family' }] : []);
    if (table === 'family_guardians') return Response.json(options.guardian ? [{ family_id: 'family' }] : []);
    if (table === 'athletes') {
      const own = options.primary || options.guardian || options.adult;
      if (options.guardian) assert.match(u.searchParams.get('or'), /family_id.in.\(family\)/);
      return Response.json(own ? [athlete] : []);
    }
    if (table === 'competition_events') return Response.json([{ ...event, ...options.event }]);
    if (table === 'competition_entries') return Response.json(saved ? [saved] : []);
    if (table === 'competition_event_tests') return Response.json(options.tests || [compatible], { status: options.testsFail ? 500 : 200 });
    if (table === 'profiles') return Response.json([{ id: 'admin' }]);
    throw new Error(`Unexpected read ${table}`);
  };
  try {
    const response = await onRequest({ env: { SUPABASE_URL: 'https://example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'test-only' }, request: new Request('https://club.invalid/api/competition-registration', { method: options.method || 'POST', headers: options.anonymous ? {} : { authorization: 'Bearer session' }, ...((options.method || 'POST') === 'POST' ? { body: JSON.stringify({ eventId: eid, athleteId: aid, testIds: options.ids || [tid] }) } : {}) }) });
    return { status: response.status, body: await response.json(), calls, writes };
  } finally { globalThis.fetch = original; }
}
test('requires a valid session and current family ownership before accessing events', async () => {
  for (const opts of [{ anonymous: true }, { authStatus: 401 }, {}]) {
    const result = await run(opts); assert.equal(result.status, opts.anonymous || opts.authStatus ? 401 : 403); assert.equal(result.writes.length, 0); assert.ok(!result.calls.some(c => c.table === 'competition_events'));
  }
});
test('primary, active additional guardian and own athlete can submit eligible test requests', async () => {
  for (const opts of [{ primary: true }, { guardian: true }, { adult: true }]) {
    const result = await run(opts); assert.equal(result.status, 200); assert.equal(result.body.entry.status, 'requested'); assert.equal(result.body.notificationPending, false);
    assert.deepEqual(result.writes.find(w => w.table === 'competition_entries').body.requested_events, [tid]);
    assert.equal(result.writes.find(w => w.table === 'competition_entries').body.requested_by, 'caller');
    assert.equal(result.writes.filter(w => w.table === 'announcement_deliveries').length, 1);
    assert.equal(result.calls.find(c => c.table === 'family_guardians').query.get('access_status'), 'eq.active');
  }
});
test('configured tests require selection and enforce sex, year, category and event membership', async () => {
  for (const opts of [{ ids: [] }, { ids: [eid] }, { tests: [{ ...compatible, eligible_sex: 'male' }] }, { tests: [{ ...compatible, max_birth_year: 2080 }] }, { tests: [{ ...compatible, eligible_categories: ['Sub 16'] }] }]) {
    const result = await run({ primary: true, tests: [compatible], ids: [tid], ...opts }); assert.equal(result.status, 400); assert.equal(result.writes.length, 0);
  }
  const result = await run({ guardian: true, tests: [compatible], ids: [tid, tid] }); assert.equal(result.status, 200); assert.deepEqual(result.body.entry.requested_events, [tid]);
});
test('unpublished, closed, past events and failed test loading never accept a request', async () => {
  for (const opts of [{ event: { published: false } }, { event: { internal_deadline: '2000-01-01' } }, { event: { starts_at: '2000-01-01' } }, { testsFail: true }]) {
    const result = await run({ primary: true, ...opts }); assert.ok(result.status >= 400); assert.equal(result.writes.length, 0);
  }
});
test('duplicates preserve decisions and concurrent requests use atomic ignore', async () => {
  for (const status of ['requested', 'approved', 'registered', 'rejected']) {
    const result = await run({ guardian: true, existing: { ...entry, status } }); assert.equal(result.body.entry.status, status); assert.equal(result.writes.length, 0);
  }
  const race = await run({ primary: true, race: true }); assert.equal(race.status, 200); assert.equal(race.writes.length, 1);
  assert.match(race.calls.find(c => c.table === 'competition_entries' && c.init.method === 'POST').init.headers.Prefer, /ignore-duplicates/);
});
test('read path returns persisted entries for all current guardians', async () => {
  const result = await run({ method: 'GET', guardian: true, existing: entry }); assert.equal(result.status, 200); assert.deepEqual(result.body.entries, [entry]); assert.equal(result.writes.length, 0);
  assert.equal(result.calls.find(c => c.table === 'competition_entries').query.get('athlete_id'), `in.(${aid})`);
  const none = await run({ method: 'GET' }); assert.deepEqual(none.body.entries, []); assert.ok(!none.calls.some(c => c.table === 'competition_entries'));
});
test('failed insert never reports success; notification failure preserves saved request', async () => {
  const failed = await run({ primary: true, insertFails: true }); assert.equal(failed.status, 502); assert.equal(failed.body.entry, undefined);
  const notice = await run({ primary: true, notificationFails: true }); assert.equal(notice.status, 200); assert.equal(notice.body.entry.status, 'requested'); assert.equal(notice.body.notificationPending, true);
});
test('category follows competition year, not stale stored training category', () => {
  assert.equal(competitionCategory({ birth_date: '2014-06-01' }, { starts_at: '2026-11-01' }), 'Sub 14');
  assert.equal(competitionCategory({ birth_date: '2014-06-01' }, { starts_at: '2028-01-01' }), 'Sub 16');
  assert.equal(competitionClosed({ ...event, internal_deadline: '2026-10-14T10:00:00Z' }, Date.parse('2026-10-14T10:00:00Z')), true);
  assert.equal(eligibleCompetitionTest(compatible, athlete, event), true);
});

test('no general requests or unconfigured competitions are accepted', async () => {
  for (const options of [{ tests: [], ids: [] }, { tests: [], ids: [tid] }, { ids: [] }]) {
    const result = await run({ primary: true, ...options });
    assert.equal(result.status, 400);
    assert.equal(result.writes.length, 0);
  }
});

// Official RFEA 2026 licence regulations, Annex 2.
test('all youth birth-year boundaries follow the federation table, including club Sub 6', () => {
  const race = { starts_at: '2026-11-01T09:30:00+01:00' };
  const groups = [[2019, 2020, 2021, 2022], [2017, 2018], [2015, 2016], [2013, 2014], [2011, 2012], [2009, 2010], [2007, 2008], [2004, 2005, 2006]];
  const categories = ['Sub 8', 'Sub 10', 'Sub 12', 'Sub 14', 'Sub 16', 'Sub 18', 'Sub 20', 'Sub 23'];
  groups.forEach((years, index) => years.forEach(year => {
    const child = { birth_date: `${year}-12-31`, federative_sex: 'F', training_category: 'Sub 6' };
    assert.equal(competitionCategory(child, race), categories[index]);
    categories.forEach((category, candidate) => {
      assert.equal(eligibleCompetitionTest({ ...compatible, eligible_categories: [category], min_birth_year: null, max_birth_year: null }, child, race), index === candidate);
    });
  }));
  const young = { birth_date: '2021-06-01', federative_sex: 'F' };
  assert.equal(eligibleCompetitionTest({ ...compatible, eligible_categories: ['Sub 8'], min_birth_year: 2019, max_birth_year: 2020 }, young, race), false);
});
