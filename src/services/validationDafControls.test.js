const test = require("node:test");
const assert = require("node:assert/strict");

const { __testables } = require("./validation.services");

const { normalizeDafControlResponse, resolveDafControlState } = __testables;

function validDafPayload(overrides = {}) {
  return {
    budget_prevu_reponse: "OUI",
    budget_disponible_reponse: "OUI",
    paiement_immediat_reponse: "OUI",
    validation_oci_reponse: "OUI",
    ligne_budgetaire_reponse: "OUI",
    ligne_budgetaire_id: 12,
    daf_controle_commentaires: {},
    ...overrides,
  };
}

test("normalizeDafControlResponse accepte les alias N/A", () => {
  assert.equal(normalizeDafControlResponse("N/A"), "NA");
  assert.equal(normalizeDafControlResponse("n.a."), "NA");
  assert.equal(normalizeDafControlResponse("not_applicable"), "NA");
});

test("resolveDafControlState accepte N/A avec commentaire par champ", () => {
  const state = resolveDafControlState(
    validDafPayload({
      budget_prevu_reponse: "N/A",
      ligne_budgetaire_reponse: "NA",
      ligne_budgetaire_id: null,
      daf_controle_commentaires: {
        budget_prevu: "Budget traite hors enveloppe.",
        ligne_budgetaire: "Pas de ligne budgetaire applicable.",
      },
    })
  );

  assert.equal(state.responses.budget_prevu, "NA");
  assert.equal(state.responses.ligne_budgetaire, "NA");
  assert.equal(state.booleans.budget_prevu, null);
  assert.equal(state.comments.budget_prevu, "Budget traite hors enveloppe.");
  assert.equal(state.comments.ligne_budgetaire, "Pas de ligne budgetaire applicable.");
});

test("resolveDafControlState refuse N/A sans commentaire", () => {
  assert.throws(
    () =>
      resolveDafControlState(
        validDafPayload({
          paiement_immediat_reponse: "NA",
          daf_controle_commentaires: {},
        })
      ),
    (err) => err?.statusCode === 400 && /Commentaire obligatoire/.test(err.message)
  );
});

test("resolveDafControlState conserve la compatibilite avec les anciens booleens", () => {
  const state = resolveDafControlState({
    budget_prevu: true,
    budget_disponible: false,
    paiement_immediat: true,
    validation_oci: false,
    ligne_budgetaire_id: 42,
  });

  assert.deepEqual(state.responses, {
    budget_prevu: "OUI",
    budget_disponible: "NON",
    paiement_immediat: "OUI",
    validation_oci: "NON",
    ligne_budgetaire: "OUI",
  });
  assert.equal(state.booleans.budget_disponible, false);
  assert.equal(state.booleans.validation_oci, false);
});
