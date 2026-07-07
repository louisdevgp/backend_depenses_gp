const test = require("node:test");
const assert = require("node:assert/strict");

const {
  candidateScopesForOrg,
  delegationScopeCoversAgent,
  delegationScopeCoversOrg,
} = require("./delegationScope.utils");

test("candidateScopesForOrg produit les portees attendues", () => {
  assert.deepEqual(candidateScopesForOrg({
    direction_id: 1,
    departement_id: 2,
    service_id: 3,
  }), ["GLOBAL", "DIRECTION:1", "DEPARTEMENT:2", "SERVICE:3"]);
});

test("une delegation globale couvre toutes les organisations", () => {
  assert.equal(delegationScopeCoversOrg(null, { direction_id: 1 }), true);
  assert.equal(delegationScopeCoversOrg("GLOBAL", { direction_id: 1 }), true);
});

test("une delegation directionnelle couvre uniquement la meme direction", () => {
  assert.equal(delegationScopeCoversOrg("DIRECTION:4", { direction_id: 4 }), true);
  assert.equal(delegationScopeCoversOrg("DIRECTION:4", { direction_id: 5 }), false);
});

test("une delegation peut couvrir un agent par direction, departement ou service", () => {
  const agent = { direction_id: 1, departement_id: 2, service_id: 3 };

  assert.equal(delegationScopeCoversAgent("DIRECTION:1", agent), true);
  assert.equal(delegationScopeCoversAgent("DEPARTEMENT:2", agent), true);
  assert.equal(delegationScopeCoversAgent("SERVICE:3", agent), true);
  assert.equal(delegationScopeCoversAgent("SERVICE:9", agent), false);
});
