import { createUserWithProfile } from "./server/user-repository.js";
import { getBeneficiaryProfileId, createAssistanceRequest, getBeneficiaryDetail, listBeneficiaries } from "./server/operations-repository.js";
import pool from "./server/database/index.js";

const email = "debug." + Date.now() + "@sanad.local";
const user = await createUserWithProfile({
  firstName: "ديباج", lastName: "باج", fullName: "ديباج باج",
  email, passwordHash: "x", phone: "01000000000", role: "beneficiary"
});
console.log("user", user.id, user.role);
const benId = await getBeneficiaryProfileId(user.id);
console.log("benId", benId);
const req = await createAssistanceRequest({ itemName: "حقيبة مدرسية", category: "شنط مدرسية", description: "تست", quantity: 2, unit: "حقيبة", notes: "" }, user.id, benId);
console.log("request", req.id, req.referenceCode, "beneficiaryId", req.beneficiaryId);

const detail = await getBeneficiaryDetail(benId);
console.log("detail.id", detail && detail.id, "detail.userId", detail && detail.userId);
console.log("needs", JSON.stringify(detail && detail.needs, null, 2));

const list = await listBeneficiaries({});
const row = list.find(b => b.id === benId);
console.log("listRow.activeNeedsCount", row && row.activeNeedsCount);
console.log("listRow.openNeeds isArray", Array.isArray(row && row.openNeeds), "raw", JSON.stringify(row && row.openNeeds));

await pool.query("DELETE FROM beneficiary_profiles WHERE user_id = $1", [user.id]).catch(() => {});
await pool.query("DELETE FROM users WHERE id = $1", [user.id]).catch(() => {});
await pool.end();