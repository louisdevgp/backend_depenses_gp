const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getActiveDelegateEntriesForNotificationRecipient,
  getActiveDelegateUsersForDemande,
  isActiveDelegateAgentForDemande,
} = require("./delegatedNotificationRecipients.utils");

test("getActiveDelegateUsersForDemande retourne les delegataires actifs couverts par la portee", async () => {
  const users = [
    { id: 20, is_active: true, deleted_at: null, email: "dorcas@example.test" },
    { id: 21, is_active: true, deleted_at: null, email: "hors-scope@example.test" },
    { id: 22, is_active: false, deleted_at: null, email: "inactive@example.test" },
  ];
  const prisma = {
    delegations: {
      findMany: async ({ where }) => {
        assert.deepEqual(where.principal_id, { in: [10] });
        assert.equal(where.is_active, true);
        return [
          {
            scope: "DIRECTION:4",
            agents_delegations_delegate_idToagents: {
              deleted_at: null,
              users: users[0],
            },
          },
          {
            scope: "DIRECTION:5",
            agents_delegations_delegate_idToagents: {
              deleted_at: null,
              users: users[1],
            },
          },
          {
            scope: "GLOBAL",
            agents_delegations_delegate_idToagents: {
              deleted_at: null,
              users: users[2],
            },
          },
        ];
      },
    },
  };

  const result = await getActiveDelegateUsersForDemande(prisma, {
    demandeur_id: 10,
    direction_id: 4,
    departement_id: null,
    service_id: null,
  });

  assert.deepEqual(result.map((u) => u.id), [20]);
});

test("getActiveDelegateUsersForDemande exclut les utilisateurs deja notifies", async () => {
  const prisma = {
    delegations: {
      findMany: async () => [
        {
          scope: "GLOBAL",
          agents_delegations_delegate_idToagents: {
            deleted_at: null,
            users: { id: 20, is_active: true, deleted_at: null },
          },
        },
      ],
    },
  };

  const result = await getActiveDelegateUsersForDemande(
    prisma,
    { demandeur_id: 10, direction_id: 4 },
    { excludeUserIds: [20] }
  );

  assert.deepEqual(result, []);
});

test("getActiveDelegateEntriesForNotificationRecipient copie une notification au delegataire du destinataire", async () => {
  const prisma = {
    agents: {
      findMany: async ({ where }) => {
        assert.deepEqual(where, { user_id: 7, deleted_at: null });
        return [{ id: 10, prenom: "Ornella", nom: "Yao", direction_id: 4 }];
      },
    },
    delegations: {
      findMany: async ({ where }) => {
        assert.deepEqual(where.principal_id, { in: [10] });
        return [
          {
            principal_id: 10,
            scope: "DIRECTION:4",
            agents_delegations_delegate_idToagents: {
              deleted_at: null,
              users: { id: 20, is_active: true, deleted_at: null, email: "dorcas@example.test" },
            },
          },
        ];
      },
    },
  };

  const result = await getActiveDelegateEntriesForNotificationRecipient(
    prisma,
    7,
    { direction_id: 4 },
    { excludeUserIds: [] }
  );

  assert.equal(result.length, 1);
  assert.equal(result[0].user.id, 20);
  assert.equal(result[0].principalAgent.nom, "Yao");
});

test("isActiveDelegateAgentForDemande autorise le delegataire actif du demandeur", async () => {
  const prisma = {
    delegations: {
      findMany: async ({ where }) => {
        assert.equal(where.principal_id, 10);
        assert.equal(where.delegate_id, 20);
        return [{ scope: "DIRECTION:4" }];
      },
    },
  };

  const result = await isActiveDelegateAgentForDemande(prisma, {
    demandeur_id: 10,
    direction_id: 4,
    departement_id: null,
    service_id: null,
  }, 20);

  assert.equal(result, true);
});

test("isActiveDelegateAgentForDemande refuse une delegation hors portee", async () => {
  const prisma = {
    delegations: {
      findMany: async () => [{ scope: "DIRECTION:5" }],
    },
  };

  const result = await isActiveDelegateAgentForDemande(prisma, { demandeur_id: 10, direction_id: 4 }, 20);

  assert.equal(result, false);
});
