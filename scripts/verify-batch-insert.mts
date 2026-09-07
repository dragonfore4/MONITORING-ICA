/**
 * Verifies the UNNEST batch insert works when parameters arrive as Postgres
 * array *literal strings*, which is what the pg/Neon driver produces from JS
 * arrays. Confirms booleans and NULLs survive the round trip.
 */
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
await db.exec(
  `CREATE TABLE t (model TEXT, ok BOOLEAN, lat INT, ttft INT, err TEXT, ts TIMESTAMPTZ);`,
);

await db.query(
  `INSERT INTO t (model, ok, lat, ttft, err, ts)
   SELECT * FROM UNNEST($1::text[], $2::boolean[], $3::int[], $4::int[], $5::text[], $6::timestamptz[])`,
  [
    "{model-a,model-b}",
    "{true,false}",
    "{111,222}",
    "{11,NULL}",
    "{NULL,boom}",
    `{"2026-01-01T00:00:00.000Z","2026-01-01T00:00:01.000Z"}`,
  ],
);

const r = await db.query<Record<string, unknown>>(
  "SELECT * FROM t ORDER BY model",
);
console.log("ARRAY-LITERAL UNNEST RESULT:");
console.table(r.rows);

const [a, b] = r.rows as Array<Record<string, unknown>>;
const checks: [string, boolean][] = [
  ["2 rows inserted", r.rows.length === 2],
  ["boolean true parsed", a.ok === true],
  ["boolean false parsed", b.ok === false],
  ["int parsed", a.lat === 111],
  ["NULL ttft became null", b.ttft === null],
  ["NULL text became null", a.err === null],
  ["text value preserved", b.err === "boom"],
  ["timestamptz parsed", a.ts instanceof Date],
];

let failed = 0;
for (const [name, pass] of checks) {
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  if (!pass) failed++;
}
console.log(failed === 0 ? "\nAll passed." : `\n${failed} FAILED.`);
process.exit(failed === 0 ? 0 : 1);
