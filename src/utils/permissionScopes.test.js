const test = require("node:test");
const assert = require("node:assert/strict");

const {
  defaultScopesForAllowedCode,
  buildOrgScopeWhere,
} = require("./permissionScopes");

test("defaultScopesForAllowedCode restreint un responsable a la direction de son agent", () => {
  const fallbackScopes = [{ type: "DIRECTION", id: 4 }];
  const codeToRoles = new Map([["DEMANDE_LIST", new Set(["RESPONSABLE"])]]);

  assert.deepEqual(
    defaultScopesForAllowedCode({
      code: "DEMANDE_LIST",
      codeToRoles,
      allowSet: new Set(),
      fallbackScopes,
    }),
    fallbackScopes
  );
});

test("defaultScopesForAllowedCode conserve le global pour les roles finance et direction generale", () => {
  const fallbackScopes = [{ type: "DIRECTION", id: 3 }];
  const codeToRoles = new Map([["DEMANDE_LIST", new Set(["DAF", "DIRECTEUR"])]]);

  assert.deepEqual(
    defaultScopesForAllowedCode({
      code: "DEMANDE_LIST",
      codeToRoles,
      allowSet: new Set(),
      fallbackScopes,
    }),
    [{ type: "GLOBAL", id: null }]
  );
});

test("buildOrgScopeWhere traduit une portee direction en filtre Prisma", () => {
  assert.deepEqual(buildOrgScopeWhere([{ type: "DIRECTION", id: 4 }]), {
    direction_id: { in: [4] },
  });
});
