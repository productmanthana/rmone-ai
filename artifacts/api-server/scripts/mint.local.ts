import { signRdsToken } from "../src/lib/rds-auth.js";
console.log(signRdsToken({ sub: "adopt-probe", tenant: "Liro", username: "__adopt_probe__", role: "", accessLevel: "user" }));
