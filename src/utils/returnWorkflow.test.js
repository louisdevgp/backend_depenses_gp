const test = require("node:test");
const assert = require("node:assert/strict");

const {
  findReturnStep,
  resolveReturnTarget,
} = require("./returnWorkflow");

function step(id, level, roleName, validatorId, status = "valide") {
  return {
    id,
    level,
    role_name: roleName,
    validator_id: validatorId,
    status,
  };
}

test("findReturnStep prend le retour le plus haut dans le parcours", () => {
  const steps = [
    step(1, 1, "RESPONSABLE", 10),
    step(2, 2, "DIRECTEUR", 20, "retour_modification"),
    step(3, 3, "DAF", 30, "retour_modification"),
  ];

  assert.equal(findReturnStep(steps).id, 3);
});

test("retour DAF revient au directeur de la direction", () => {
  const steps = [
    step(1, 1, "RESPONSABLE", 10),
    step(2, 2, "DIRECTEUR", 20),
    step(3, 3, "DAF", 30, "retour_modification"),
  ];

  const result = resolveReturnTarget({
    steps,
    demandeurId: 99,
    directionDirectorAgentId: 20,
  });

  assert.equal(result.kind, "direction_director");
  assert.equal(result.targetAgentId, 20);
  assert.equal(result.targetRole, "DIRECTEUR");
  assert.equal(result.restartLevel, 3);
});

test("retour DGA ou DG revient au dernier directeur valide avant le niveau courant", () => {
  const steps = [
    step(1, 1, "RESPONSABLE", 10),
    step(2, 2, "DIRECTEUR", 20),
    step(3, 3, "DAF", 30),
    step(4, 4, "DGA", 40, "retour_modification"),
    step(5, 5, "DG", 50, "bloque"),
  ];

  const result = resolveReturnTarget({ steps, demandeurId: 99 });

  assert.equal(result.kind, "validation_step");
  assert.equal(result.targetAgentId, 20);
  assert.equal(result.targetRole, "DIRECTEUR");
  assert.equal(result.restartLevel, 2);
});

test("retour responsable revient au demandeur quand il n'existe pas de niveau precedent", () => {
  const steps = [
    step(1, 1, "RESPONSABLE", 10, "retour_modification"),
    step(2, 2, "DIRECTEUR", 20, "bloque"),
  ];

  const result = resolveReturnTarget({ steps, demandeurId: 99 });

  assert.equal(result.kind, "demandeur");
  assert.equal(result.targetAgentId, 99);
  assert.equal(result.targetRole, "DEMANDEUR");
});
