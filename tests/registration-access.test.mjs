import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

const code = buildSync({
  entryPoints: ["src/lib/registrationAccess.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
}).outputFiles[0].text;
const { loadParentAthleteStatuses } = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
);

function query(data) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    then: (resolve) => resolve({ data }),
  };
  return chain;
}

test("an active additional guardian inherits the athlete access state", async () => {
  const calls = [];
  const client = {
    from(table) {
      calls.push(table);
      if (table === "families") return query([]);
      if (table === "family_guardians") return query([{ family_id: "family-2" }]);
      if (table === "athletes") return query([{ club_status: "active" }]);
      throw new Error(`Unexpected table ${table}`);
    },
  };

  assert.deepEqual(await loadParentAthleteStatuses(client, "mother"), [
    { club_status: "active" },
  ]);
  assert.deepEqual(calls, ["families", "family_guardians", "athletes"]);
});

test("primary and additional links are deduplicated before loading athletes", async () => {
  let familyIds;
  const client = {
    from(table) {
      if (table === "families") return query([{ id: "family-1" }]);
      if (table === "family_guardians") return query([{ family_id: "family-1" }]);
      if (table === "athletes") {
        const chain = query([]);
        chain.in = (_column, ids) => {
          familyIds = ids;
          return chain;
        };
        return chain;
      }
      throw new Error(`Unexpected table ${table}`);
    },
  };

  await loadParentAthleteStatuses(client, "parent");
  assert.deepEqual(familyIds, ["family-1"]);
});
