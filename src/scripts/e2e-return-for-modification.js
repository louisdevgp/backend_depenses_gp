/* eslint-disable no-console */
const axios = require("axios");

const API_URL = (process.env.API_URL || "http://localhost:8000/api").replace(/\/$/, "");
const PASSWORD = process.env.E2E_PASSWORD || "Test@1234";
const TIMEOUT_MS = Number(process.env.E2E_TIMEOUT_MS || 30_000);

async function login(email) {
  console.log(`[e2e] login as ${email}`);
  const { data } = await axios.post(`${API_URL}/auth/login`, { email, password: PASSWORD }, { timeout: TIMEOUT_MS });
  const token = data?.data?.accessToken || data?.accessToken;
  if (!token) throw new Error(`LOGIN_FAILED_NO_TOKEN:${email}`);
  return token;
}

function client(token) {
  return axios.create({
    baseURL: API_URL,
    timeout: TIMEOUT_MS,
    headers: { Authorization: `Bearer ${token}` },
  });
}

function pickPendingStep(pendings, demandeId) {
  const step = (pendings || []).find((s) => Number(s?.demande_id) === Number(demandeId) || Number(s?.demandeId) === Number(demandeId));
  return step || null;
}

async function main() {
  console.log(`[e2e] API_URL=${API_URL}`);

  const dafToken = await login("daf@gp.local");
  const dgaToken = await login("dga@gp.local");
  const dgToken = await login("dg@gp.local");

  const daf = client(dafToken);
  const dga = client(dgaToken);
  const dg = client(dgToken);

  // 1) Create demande as DAF (flow: DGA -> DG). This avoids org/hierarchy requirements.
  const createPayload = {
    motif: `E2E retour modif ${new Date().toISOString()}`,
    montant: 1234.56,
    beneficiaire: "E2E Beneficiaire",
    description: "Initial",
    conditions_paiement_mode: "100/100",
  };

  console.log("[e2e] creating demande as DAF...");
  const created = await daf.post("/demandes", createPayload);
  const demande = created?.data?.data;
  if (!demande?.id) throw new Error("CREATE_DEMANDE_FAILED");
  console.log(`[e2e] demande created: id=${demande.id} uuid=${demande.uuid} statut=${demande.statut}`);

  // 2) DGA approves step 1
  console.log("[e2e] fetching DGA pending validations...");
  const dgaPendingsRes = await dga.get("/validations/pending");
  const dgaPendings = dgaPendingsRes?.data?.data || dgaPendingsRes?.data;
  const dgaStep = pickPendingStep(dgaPendings, demande.id);
  if (!dgaStep?.id) {
    throw new Error(`NO_DGA_PENDING_STEP_FOR_DEMANDE:${demande.id}`);
  }
  console.log(`[e2e] approving DGA stepId=${dgaStep.id}...`);
  await dga.post(`/validations/${dgaStep.id}/approve`, { commentaire: "OK DGA (e2e)", signature_data_url: null });
  console.log(`[e2e] DGA approved stepId=${dgaStep.id}`);

  // 3) DG returns step 2 for modification
  console.log("[e2e] fetching DG pending validations...");
  const dgPendingsRes = await dg.get("/validations/pending");
  const dgPendings = dgPendingsRes?.data?.data || dgPendingsRes?.data;
  const dgStep = pickPendingStep(dgPendings, demande.id);
  if (!dgStep?.id) {
    throw new Error(`NO_DG_PENDING_STEP_FOR_DEMANDE:${demande.id}`);
  }
  console.log(`[e2e] returning DG stepId=${dgStep.id} for modification...`);
  await dg.post(`/validations/${dgStep.id}/return-for-modification`, { commentaire: "Merci de corriger (e2e)" });
  console.log(`[e2e] DG returned stepId=${dgStep.id} for modification`);

  // 4) Demandeur (DAF) sees demande in a_modifier
  console.log("[e2e] fetching demande after return...");
  const afterReturn = await daf.get(`/demandes/${demande.id}`);
  const demandeAfterReturn = afterReturn?.data?.data;
  console.log(`[e2e] after return: statut=${demandeAfterReturn?.statut}`);
  if (String(demandeAfterReturn?.statut || "").toLowerCase() !== "a_modifier") {
    throw new Error(`EXPECTED_A_MODIFIER_GOT:${demandeAfterReturn?.statut}`);
  }

  // 5) Demandeur edits to trigger reopening N-1 (DGA)
  console.log("[e2e] updating demande to trigger reopen N-1...");
  const updated = await daf.put(`/demandes/${demande.id}`, { description: "Corrected after return (e2e)" });
  const demandeUpdated = updated?.data?.data;
  console.log(`[e2e] after update: statut=${demandeUpdated?.statut}`);

  if (String(demandeUpdated?.statut || "").toLowerCase() !== "validation_dga") {
    throw new Error(`EXPECTED_VALIDATION_DGA_GOT:${demandeUpdated?.statut}`);
  }

  // 6) Assert steps are consistent: DGA is en_attente, DG is bloque
  const steps = Array.isArray(demandeUpdated?.validation_steps) ? demandeUpdated.validation_steps : [];
  const stepDga = steps.find((s) => String(s.role_name || "").toUpperCase() === "DGA");
  const stepDg = steps.find((s) => String(s.role_name || "").toUpperCase() === "DG");
  console.log(`[e2e] steps: DGA=${stepDga?.status} (level=${stepDga?.level}) | DG=${stepDg?.status} (level=${stepDg?.level})`);

  if (stepDga?.status !== "en_attente") throw new Error(`EXPECTED_DGA_EN_ATTENTE_GOT:${stepDga?.status}`);
  if (stepDg?.status !== "bloque") throw new Error(`EXPECTED_DG_BLOQUE_GOT:${stepDg?.status}`);

  console.log("[e2e] ✅ return-for-modification workflow OK");
}

main().catch((e) => {
  const status = e?.response?.status;
  const data = e?.response?.data;
  console.error("[e2e] ❌ failed:", e?.message || String(e));
  if (e?.stack) console.error("[e2e] stack:", String(e.stack));
  if (status) console.error("[e2e] http status:", status);
  if (data) console.error("[e2e] http data:", JSON.stringify(data));
  process.exit(1);
});
