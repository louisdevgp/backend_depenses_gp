const assert = require("assert");
const { resolveReturnTarget } = require("../utils/returnWorkflow");

function step(id, level, role_name, validator_id) {
  return { id, level, role_name, validator_id, status: "valide" };
}

function resolve({ steps, returnStepId, demandeurId, directionDirectorAgentId = null }) {
  const returnStep = steps.find((item) => item.id === returnStepId);
  return resolveReturnTarget({
    steps,
    returnStep,
    demandeurId,
    directionDirectorAgentId,
  });
}

const lambdaFlow = [
  step(1, 1, "RESPONSABLE", 101),
  step(2, 2, "DIRECTEUR", 102),
  step(3, 3, "DAF", 103),
  step(4, 4, "DGA", 104),
  step(5, 5, "DG", 105),
];

assert.equal(
  resolve({ steps: lambdaFlow, returnStepId: 1, demandeurId: 100 }).targetAgentId,
  100,
  "Le Responsable retourne au demandeur"
);
assert.equal(
  resolve({ steps: lambdaFlow, returnStepId: 2, demandeurId: 100 }).targetAgentId,
  101,
  "Le Directeur retourne au Responsable"
);

const dafReturn = resolve({
  steps: lambdaFlow,
  returnStepId: 3,
  demandeurId: 100,
  directionDirectorAgentId: 102,
});
assert.equal(dafReturn.targetAgentId, 102, "Le DAF retourne au Directeur de la direction");
assert.equal(dafReturn.targetRole, "DIRECTEUR");
assert.equal(dafReturn.targetStep, null, "Le Directeur corrige sans refaire une validation Directeur");
assert.equal(dafReturn.restartLevel, 3, "Apres correction, la reprise se fait au DAF");

for (const returnStepId of [4, 5]) {
  const result = resolve({ steps: lambdaFlow, returnStepId, demandeurId: 100 });
  assert.equal(result.targetAgentId, 102, "DGA/DG retourne au Directeur");
  assert.equal(result.targetRole, "DIRECTEUR");
}

const directorFlow = [
  step(11, 1, "DAF", 203),
  step(12, 2, "DGA", 204),
  step(13, 3, "DG", 205),
];
assert.equal(
  resolve({
    steps: directorFlow,
    returnStepId: 11,
    demandeurId: 202,
    directionDirectorAgentId: 202,
  }).targetAgentId,
  202,
  "Le Directeur demandeur recupere le retour du DAF"
);

assert.equal(
  resolve({
    steps: directorFlow,
    returnStepId: 11,
    demandeurId: 999,
    directionDirectorAgentId: 202,
  }).targetAgentId,
  202,
  "Le retour DAF vise le Directeur de la direction, pas le demandeur"
);

const dafFlow = [
  step(21, 1, "DGA", 304),
  step(22, 2, "DG", 305),
];
assert.equal(
  resolve({ steps: dafFlow, returnStepId: 21, demandeurId: 303 }).targetAgentId,
  303,
  "Le DAF demandeur recupere le retour du DGA"
);
assert.equal(
  resolve({ steps: dafFlow, returnStepId: 22, demandeurId: 303 }).targetAgentId,
  303,
  "Le DAF demandeur recupere aussi un retour du DG"
);

const dgaFlow = [step(26, 1, "DG", 305)];
assert.equal(
  resolve({ steps: dgaFlow, returnStepId: 26, demandeurId: 304 }).targetAgentId,
  304,
  "Le DGA demandeur recupere le retour du DG"
);

const dgFlow = [step(31, 1, "DGA", 404)];
assert.equal(
  resolve({ steps: dgFlow, returnStepId: 31, demandeurId: 405 }).targetAgentId,
  405,
  "Le DG demandeur recupere le retour du DGA"
);

console.log("Return workflow scenarios: OK");
