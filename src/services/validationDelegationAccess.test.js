const test = require("node:test");
const assert = require("node:assert/strict");

const { getCurrentUserValidationAccess } = require("./validation.services");

test("une delegation DAF autorise une etape DIRECTEUR du meme principal", async () => {
  const client = {
    agents: {
      findFirst: async ({ where }) => {
        assert.equal(where.user_id, 8);
        return { id: 7 };
      },
    },
    demandes_paiement: {
      findUnique: async ({ where }) => {
        assert.equal(where.id, 134);
        return { direction_id: 3, departement_id: 2, service_id: null };
      },
    },
    delegations: {
      findMany: async ({ where }) => {
        assert.equal(where.principal_id, 6);
        assert.equal(where.delegate_id, 7);
        assert.deepEqual(where.OR, [
          { scope: null },
          { scope: { in: ["GLOBAL", "DIRECTION:3", "DEPARTEMENT:2"] } },
        ]);
        return [{ id: 4, role_name: "DAF" }];
      },
    },
  };

  const access = await getCurrentUserValidationAccess({
    userId: 8,
    client,
    demande: {
      validation_steps: [
        {
          id: 533,
          uuid: "67ddf253-test",
          demande_id: 134,
          level: 1,
          role_name: "DIRECTEUR",
          validator_id: 6,
          status: "en_attente",
        },
      ],
    },
  });

  assert.deepEqual(access, {
    step_id: 533,
    step_uuid: "67ddf253-test",
    role_name: "DIRECTEUR",
    can_act: true,
    by_assignment: false,
    by_delegation: true,
  });
});