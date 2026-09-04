import { signRdsToken } from "../src/lib/rds-auth.js";
console.log(signRdsToken({ sub: "grid-probe", tenant: "Alston AI", username: "__grid_probe__", role: "", accessLevel: "admin" }));
