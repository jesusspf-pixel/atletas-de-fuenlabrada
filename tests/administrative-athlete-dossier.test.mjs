import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet } from '../functions/api/administrative-athlete-dossier.ts';
const athleteId = '11111111-1111-4111-8111-111111111111';
const env = { SUPABASE_URL: 'https://example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'test-only' };
async function run({ role = 'administrative_viewer', authStatus = 200, profileStatus = 200, athleteStatus = 200, athlete = { id: athleteId }, token = 'session', id = athleteId } = {}) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/auth/v1/user')) return Response.json({ id: 'caller' }, { status: authStatus });
    if (parsed.pathname.endsWith('/profiles')) return Response.json(role ? [{ role }] : [], { status: profileStatus });
    if (parsed.pathname.endsWith('/athletes')) return Response.json(athlete ? [athlete] : [], { status: athleteStatus });
    throw new Error('Unexpected request');
  };
  try {
    const response = await onRequestGet({ request: new Request(`https://club.invalid/api/administrative-athlete-dossier?athleteId=${encodeURIComponent(id)}`, { headers: token ? { authorization: `Bearer ${token}` } : {} }), env });
    return { response, body: await response.json(), calls };
  } finally { globalThis.fetch = original; }
}
test('anonymous and expired sessions cannot read dossiers', async () => {
  const anonymous = await run({ token: '' }); assert.equal(anonymous.response.status, 401); assert.equal(anonymous.calls.length, 0);
  const expired = await run({ authStatus: 401 }); assert.equal(expired.response.status, 401); assert.equal(expired.calls.length, 1);
});
test('other roles cannot reach the privileged athlete query', async () => {
  for (const role of ['parent', 'coach', 'adult_athlete', 'minor_athlete', null]) {
    const result = await run({ role }); assert.equal(result.response.status, 403); assert.equal(result.calls.length, 2);
  }
});
test('only existing administrative roles receive one complete dossier with no caching', async () => {
  const athlete = { id: athleteId, families: { profiles: { email: 'parent@example.invalid', phone: '600000000' }, family_guardians: [{ profiles: { email: 'other@example.invalid' } }] }, federation_license_applications: [{ form_data: { guardian_email: 'submitted@example.invalid', address_line: 'Example' } }] };
  for (const role of ['owner', 'admin', 'administrative_viewer']) {
    const result = await run({ role, athlete }); assert.equal(result.response.status, 200); assert.deepEqual(result.body, { athlete });
    assert.match(result.response.headers.get('cache-control'), /no-store/);
    assert.equal(result.response.headers.get('vary'), 'Authorization');
    const query = new URL(result.calls[2]).searchParams; assert.equal(query.get('id'), `eq.${athleteId}`); assert.equal(query.get('limit'), '1');
    assert.ok(query.get('select').includes('family_guardians_profile_id_fkey')); assert.ok(query.get('select').includes('form_data'));
    assert.ok(!query.get('select').includes('*'));
  }
});
test('invalid IDs, missing athletes and database failures fail closed', async () => {
  const invalid = await run({ id: 'x&select=*' }); assert.equal(invalid.response.status, 400); assert.equal(invalid.calls.length, 2);
  assert.equal((await run({ athlete: null })).response.status, 404);
  const profileFailure = await run({ profileStatus: 500 }); assert.equal(profileFailure.response.status, 502); assert.equal(profileFailure.calls.length, 2);
  assert.equal((await run({ athleteStatus: 500 })).response.status, 502);
});
