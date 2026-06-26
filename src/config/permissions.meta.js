const P = require("../constants/permissions");

// Metadata for permissions: module + where it applies (menu/action).
// appliesTo: ["menu", "action"] | ["menu"] | ["action"]
module.exports = {
  // Admin / RBAC
  [P.PERMISSIONS_MANAGE]: { module: "Administration", appliesTo: ["menu", "action"] },
  [P.USERS_MANAGE]: { module: "Administration", appliesTo: ["menu", "action"] },
  [P.USER_ROLES_MANAGE]: { module: "Administration", appliesTo: ["menu", "action"] },
  [P.ROLES_MANAGE]: { module: "Administration", appliesTo: ["menu", "action"] },
  [P.AGENTS_MANAGE]: { module: "Administration", appliesTo: ["menu", "action"] },
  [P.DIRECTIONS_MANAGE]: { module: "Administration", appliesTo: ["menu", "action"] },
  [P.DEPARTEMENTS_MANAGE]: { module: "Administration", appliesTo: ["menu", "action"] },
  [P.SERVICES_MANAGE]: { module: "Administration", appliesTo: ["menu", "action"] },
  [P.VALIDATION_FLOWS_MANAGE]: { module: "Administration", appliesTo: ["menu", "action"] },

  // Notifications
  [P.NOTIFICATIONS_ADMIN_CREATE]: { module: "Notifications", appliesTo: ["action"] },

  // Receptions
  [P.RECEPTION_CREATE]: { module: "Receptions", appliesTo: ["action"] },
  [P.RECEPTION_LIST]: { module: "Receptions", appliesTo: ["menu", "action"] },
  [P.RECEPTION_LIST_SELF]: { module: "Receptions", appliesTo: ["menu", "action"] },
  [P.RECEPTION_LIST_ALL]: { module: "Receptions", appliesTo: ["menu", "action"] },
  [P.RECEPTION_GET]: { module: "Receptions", appliesTo: ["action"] },
  [P.RECEPTION_PDF]: { module: "Receptions", appliesTo: ["action"] },
  [P.RECEPTION_UPDATE]: { module: "Receptions", appliesTo: ["action"] },
  [P.RECEPTION_DELETE]: { module: "Receptions", appliesTo: ["action"] },
  [P.RECEPTION_VISA_DIRECTEUR]: { module: "Receptions", appliesTo: ["menu", "action"] },
  [P.RECEPTION_VISA_DAF]: { module: "Receptions", appliesTo: ["menu", "action"] },

  // Validations
  [P.VALIDATION_LIST_PENDING]: { module: "Validations", appliesTo: ["menu", "action"] },
  [P.DELEGATIONS_MANAGE]: { module: "Validations", appliesTo: ["menu", "action"] },
  [P.VALIDATION_APPROVE]: { module: "Validations", appliesTo: ["action"] },
  [P.VALIDATION_REJECT]: { module: "Validations", appliesTo: ["action"] },
  [P.VALIDATION_RETURN_FOR_MODIFICATION]: { module: "Validations", appliesTo: ["action"] },
  [P.VALIDATION_LIST_DONE]: { module: "Validations", appliesTo: ["menu", "action"] },
  [P.VALIDATION_LIST_ALL]: { module: "Validations", appliesTo: ["menu", "action"] },
  [P.VALIDATION_GET]: { module: "Validations", appliesTo: ["action"] },
  [P.VALIDATION_CANCEL]: { module: "Validations", appliesTo: ["action"] },

  // Paiements
  [P.PAIEMENT_CREATE]: { module: "Paiements", appliesTo: ["action"] },
  [P.PAIEMENT_LIST]: { module: "Paiements", appliesTo: ["menu", "action"] },
  [P.PAIEMENT_GET]: { module: "Paiements", appliesTo: ["action"] },
  [P.PAIEMENT_UPDATE]: { module: "Paiements", appliesTo: ["action"] },
  [P.PAIEMENT_DELETE]: { module: "Paiements", appliesTo: ["action"] },

  // Lignes budgetaires
  [P.BUDGET_LINE_CREATE]: { module: "Budget", appliesTo: ["action"] },
  [P.BUDGET_LINE_UPDATE]: { module: "Budget", appliesTo: ["action"] },
  [P.BUDGET_LINE_LIST]: { module: "Budget", appliesTo: ["menu", "action"] },
  [P.BUDGET_LINE_GET]: { module: "Budget", appliesTo: ["action"] },
  [P.BUDGET_LINE_USE]: { module: "Budget", appliesTo: ["action"] },
  [P.BUDGET_LINE_DELETE]: { module: "Budget", appliesTo: ["action"] },

  // Demandes
  [P.DEMANDE_CREATE]: { module: "Demandes", appliesTo: ["menu", "action"] },
  [P.DEMANDE_LIST]: { module: "Demandes", appliesTo: ["menu", "action"] },
  [P.DEMANDE_LIST_SELF]: { module: "Demandes", appliesTo: ["menu", "action"] },
  [P.DEMANDE_LIST_ALL]: { module: "Demandes", appliesTo: ["menu", "action"] },
  [P.DEMANDE_LIST_ASSIGNED_ACHETEUR]: { module: "Demandes", appliesTo: ["menu", "action"] },
  [P.DEMANDE_PDF]: { module: "Demandes", appliesTo: ["action"] },
  [P.DEMANDE_UPDATE]: { module: "Demandes", appliesTo: ["action"] },
  [P.DEMANDE_DELETE]: { module: "Demandes", appliesTo: ["action"] },
  [P.DEMANDE_LIST_BY_DEMANDEUR]: { module: "Demandes", appliesTo: ["action"] },
  [P.DEMANDE_ASSIGN_ACHETEUR]: { module: "Demandes", appliesTo: ["action"] },
  [P.DEMANDE_CLOSE]: { module: "Demandes", appliesTo: ["action"] },
  [P.DEMANDE_REOPEN]: { module: "Demandes", appliesTo: ["action"] },

  // Dashboard
  [P.DASHBOARD_VIEW_SELF]: { module: "Dashboard", appliesTo: ["menu", "action"] },
  [P.DASHBOARD_VIEW_ALL]: { module: "Dashboard", appliesTo: ["menu", "action"] },
  [P.VIEW_GLOBAL_DASH_BY_ENTITY]: {
    module: "Dashboard",
    appliesTo: ["menu", "action"],
    description: "Etend la vue globale au perimetre directionnel (par entite).",
  },
  [P.BUDGET_DASHBOARD_VIEW]: {
    module: "Dashboard",
    appliesTo: ["action"],
    description: "Affiche les indicateurs de lignes budgetaires dans le dashboard.",
  },

  // Bon de commande
  [P.BON_COMMANDE_CREATE]: { module: "BonCommande", appliesTo: ["action"] },
  [P.BON_COMMANDE_LIST]: { module: "BonCommande", appliesTo: ["menu", "action"] },
  [P.BON_COMMANDE_GET]: { module: "BonCommande", appliesTo: ["action"] },
  [P.BON_COMMANDE_PDF]: { module: "BonCommande", appliesTo: ["action"] },
  [P.BON_COMMANDE_UPDATE]: { module: "BonCommande", appliesTo: ["action"] },
  [P.BON_COMMANDE_CANCEL]: { module: "BonCommande", appliesTo: ["action"] },
  [P.BON_COMMANDE_DELETE]: { module: "BonCommande", appliesTo: ["action"] },
};
