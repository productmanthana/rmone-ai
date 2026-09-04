import assert from "node:assert/strict";
import { canReactivateDisabledStaff } from "../disabledStaff.js";

const GUID = "aaaaaaaa-0000-0000-0000-000000000001";

assert.equal(canReactivateDisabledStaff(false, GUID, "project-tenant", true), true);
assert.equal(canReactivateDisabledStaff(false, GUID, "", true), false, "must not fall back to the viewer tenant");
assert.equal(canReactivateDisabledStaff(false, GUID, "project-tenant", false), false);
assert.equal(canReactivateDisabledStaff(true, GUID, "project-tenant", true), false);
console.log("✓ disabled staff reactivation requires the member/project tenant");