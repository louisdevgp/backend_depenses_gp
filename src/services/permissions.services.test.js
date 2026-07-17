const test = require("node:test");
const assert = require("node:assert/strict");

const { __testables } = require("./permissions.services");

const { defaultScopesFromAgent, normalizeScopePayload } = __testables;

test("defaultScopesFromAgent privilegie la direction de l'agent", () => {
  assert.deepEqual(
    defaultScopesFromAgent({ direction_id: 4, departement_id: 9, service_id: 2 }),
    [{ type: "DIRECTION", id: 4 }]
  );
});

test("defaultScopesFromAgent retombe sur global seulement sans organisation", () => {
  assert.deepEqual(defaultScopesFromAgent({}), [{ type: "GLOBAL", id: null }]);
});

test("normalizeScopePayload ignore les portees organisationnelles sans id", () => {
  assert.deepEqual(
    normalizeScopePayload({
      demande_list: [
        { type: "GLOBAL", id: 12 },
        { type: "DIRECTION", id: "" },
        { type: "DIRECTION", id: 4 },
      ],
    }),
    {
      DEMANDE_LIST: [
        { type: "GLOBAL", id: null },
        { type: "DIRECTION", id: 4 },
      ],
    }
  );
});
