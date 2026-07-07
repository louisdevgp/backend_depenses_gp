const test = require("node:test");
const assert = require("node:assert/strict");

const { canManageDelegation } = require("./delegationPermissions.utils");

test("un admin peut gérer toute délégation", () => {
  assert.equal(canManageDelegation({ admin: true, actorAgentId: 10, principalId: 20 }), true);
});

test("le principal peut modifier, activer ou supprimer sa propre délégation", () => {
  assert.equal(canManageDelegation({ actorAgentId: 10, principalId: 10 }), true);
  assert.equal(canManageDelegation({ actorAgentId: "10", principalId: 10 }), true);
});

test("le délégataire ne peut pas gérer une délégation reçue", () => {
  assert.equal(canManageDelegation({ actorAgentId: 20, principalId: 10 }), false);
});

test("un acteur non identifié ne peut pas gérer une délégation", () => {
  assert.equal(canManageDelegation({ actorAgentId: null, principalId: 10 }), false);
  assert.equal(canManageDelegation({ actorAgentId: "abc", principalId: 10 }), false);
});
