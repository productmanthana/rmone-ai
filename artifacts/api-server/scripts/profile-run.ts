import { signRdsToken } from "../src/lib/rds-auth.js";

const uploadId = process.argv[2] ?? "7bbf53e5-7910-47e3-b4a3-827569ed44d5";
const mode = process.argv[3] ?? "replace";

const tok = signRdsToken({
  sub: "profiling",
  tenant: "test20",
  username: "samtender12@gmail.com",
  role: "admin",
  accessLevel: "admin",
});

const r = await fetch("http://localhost:8080/api/onboarding/run", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
  body: JSON.stringify({ uploadId, importMode: mode }),
});
const txt = await r.text();
console.log(`RUN_HTTP_STATUS=${r.status}`);
console.log(`RUN_BODY=${txt.slice(0, 500)}`);
process.exit(0);
