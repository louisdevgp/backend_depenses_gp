const { getArchivePrisma, archiveTable: table } = require("../config/archivePrisma");

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeText(value) {
  if (typeof value !== "string") return value;
  return value.replace(/\\r?\\n|\\t/g, " ").replace(/\s+/g, " ").trim();
}

function cleanRow(row) {
  if (!row || typeof row !== "object") return row;
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => {
      if (typeof value === "bigint") return [key, Number(value)];
      if (typeof value === "string") return [key, normalizeText(value)];
      return [key, value];
    })
  );
}

function cleanRows(rows) {
  return (rows || []).map(cleanRow);
}

async function listDemandes(query = {}) {
  const where = ["d.deleted_at IS NULL"];
  const params = [];

  if (query.statut) {
    where.push("d.statut = ?");
    params.push(String(query.statut));
  }
  if (query.q) {
    where.push("(d.motif LIKE ? OR d.beneficiaire LIKE ? OR a.nom LIKE ?)");
    const q = `%${String(query.q).trim()}%`;
    params.push(q, q, q);
  }
  if (query.beneficiaire) {
    where.push("d.beneficiaire LIKE ?");
    params.push(`%${String(query.beneficiaire).trim()}%`);
  }
  if (query.dateStart) {
    where.push("DATE(d.date_creation) >= ?");
    params.push(String(query.dateStart).slice(0, 10));
  }
  if (query.dateEnd) {
    where.push("DATE(d.date_creation) <= ?");
    params.push(String(query.dateEnd).slice(0, 10));
  }

  const sql = `
    SELECT
      d.id,
      d.agent_id,
      d.montant,
      d.motif,
      d.beneficiaire,
      d.statut,
      d.requiert_proforma,
      d.date_creation,
      d.demande_physique_signee_url,
      d.note,
      a.nom AS agent_nom,
      a.fonction AS agent_fonction,
      e.nom AS entite_nom,
      s.nom AS section_nom,
      COALESCE(v.validations_count, 0) AS validations_count,
      COALESCE(p.paiements_count, 0) AS paiements_count,
      COALESCE(pf.proformas_count, 0) AS proformas_count,
      COALESCE(dp.documents_paiement_count, 0) AS documents_paiement_count,
      CASE WHEN ac.id IS NULL THEN 0 ELSE 1 END AS achat_effectue
    FROM ${table("demandes_paiement")} d
    LEFT JOIN ${table("agents")} a ON a.id = d.agent_id
    LEFT JOIN ${table("entites")} e ON e.id = a.entite_id
    LEFT JOIN ${table("sections")} s ON s.id = a.section_id
    LEFT JOIN (
      SELECT demande_id, COUNT(*) AS validations_count
      FROM ${table("validations")}
      GROUP BY demande_id
    ) v ON v.demande_id = d.id
    LEFT JOIN (
      SELECT demande_id, COUNT(*) AS paiements_count
      FROM ${table("paiements")}
      GROUP BY demande_id
    ) p ON p.demande_id = d.id
    LEFT JOIN (
      SELECT demande_id, COUNT(*) AS proformas_count
      FROM ${table("proformas")}
      GROUP BY demande_id
    ) pf ON pf.demande_id = d.id
    LEFT JOIN (
      SELECT p.demande_id, COUNT(dp.id) AS documents_paiement_count
      FROM ${table("paiements")} p
      JOIN ${table("documents_paiements")} dp ON dp.paiement_id = p.id
      GROUP BY p.demande_id
    ) dp ON dp.demande_id = d.id
    LEFT JOIN ${table("achats")} ac ON ac.demande_id = d.id
    WHERE ${where.join(" AND ")}
    ORDER BY d.date_creation DESC, d.id DESC
  `;

  const rows = await getArchivePrisma().$queryRawUnsafe(sql, ...params);
  return cleanRows(rows).map((row) => ({
    ...row,
    montant: toNumber(row.montant),
    validations_count: toNumber(row.validations_count),
    paiements_count: toNumber(row.paiements_count),
    proformas_count: toNumber(row.proformas_count),
    documents_paiement_count: toNumber(row.documents_paiement_count),
    achat_effectue: Boolean(Number(row.achat_effectue || 0)),
  }));
}

async function getDemande(id) {
  const demandeId = Number(id);
  if (!Number.isInteger(demandeId) || demandeId <= 0) {
    const err = new Error("Identifiant archive V1 invalide");
    err.statusCode = 400;
    throw err;
  }

  const demandes = await getArchivePrisma().$queryRawUnsafe(
    `
      SELECT
        d.*,
        a.nom AS agent_nom,
        a.fonction AS agent_fonction,
        e.nom AS entite_nom,
        s.nom AS section_nom,
        sup.nom AS superieur_nom,
        sup.fonction AS superieur_fonction
      FROM ${table("demandes_paiement")} d
      LEFT JOIN ${table("agents")} a ON a.id = d.agent_id
      LEFT JOIN ${table("agents")} sup ON sup.id = a.superieur_id
      LEFT JOIN ${table("entites")} e ON e.id = a.entite_id
      LEFT JOIN ${table("sections")} s ON s.id = a.section_id
      WHERE d.id = ?
      LIMIT 1
    `,
    demandeId
  );
  const demande = cleanRow(demandes?.[0]);
  if (!demande) {
    const err = new Error("Demande archive V1 introuvable");
    err.statusCode = 404;
    throw err;
  }

  const [validations, paiements, proformas, achat] = await Promise.all([
    getArchivePrisma().$queryRawUnsafe(
      `
        SELECT
          v.*,
          u.id AS valideur_user_id,
          u.email AS valideur_email,
          u.agent_id AS valideur_agent_id,
          a.nom AS valideur_nom,
          a.fonction AS valideur_fonction,
          e.nom AS valideur_entite_nom,
          s.nom AS valideur_section_nom
        FROM ${table("validations")} v
        LEFT JOIN ${table("utilisateurs")} u ON u.id = v.valideur_id
        LEFT JOIN ${table("agents")} a ON a.id = u.agent_id
        LEFT JOIN ${table("entites")} e ON e.id = a.entite_id
        LEFT JOIN ${table("sections")} s ON s.id = a.section_id
        WHERE v.demande_id = ?
        ORDER BY v.date_validation ASC, v.id ASC
      `,
      demandeId
    ),
    getArchivePrisma().$queryRawUnsafe(
      `
        SELECT p.*
        FROM ${table("paiements")} p
        WHERE p.demande_id = ?
        ORDER BY p.date_paiement ASC, p.id ASC
      `,
      demandeId
    ),
    getArchivePrisma().$queryRawUnsafe(
      `
        SELECT *
        FROM ${table("proformas")}
        WHERE demande_id = ?
        ORDER BY date_ajout ASC, id ASC
      `,
      demandeId
    ),
    getArchivePrisma().$queryRawUnsafe(
      `
        SELECT ac.*, a.nom AS acheteur_nom, a.fonction AS acheteur_fonction
        FROM ${table("achats")} ac
        LEFT JOIN ${table("agents")} a ON a.id = ac.acheteur_id
        WHERE ac.demande_id = ?
        LIMIT 1
      `,
      demandeId
    ),
  ]);

  const paiementRows = cleanRows(paiements);
  const paiementIds = paiementRows.map((p) => Number(p.id)).filter(Boolean);
  let documentsPaiement = [];
  if (paiementIds.length) {
    documentsPaiement = cleanRows(
      await getArchivePrisma().$queryRawUnsafe(
        `
          SELECT *
          FROM ${table("documents_paiements")}
          WHERE paiement_id IN (${paiementIds.map(() => "?").join(",")})
          ORDER BY date_ajout ASC, id ASC
        `,
        ...paiementIds
      )
    );
  }

  const achatRow = cleanRow(achat?.[0]) || null;
  let preuvesAchat = [];
  if (achatRow?.id) {
    preuvesAchat = cleanRows(
      await getArchivePrisma().$queryRawUnsafe(
        `
          SELECT *
          FROM ${table("preuves_achat")}
          WHERE achat_id = ?
          ORDER BY date_ajout ASC, id ASC
        `,
        Number(achatRow.id)
      )
    );
  }

  return {
    demande: { ...demande, montant: toNumber(demande.montant) },
    validations: cleanRows(validations),
    paiements: paiementRows.map((p) => ({
      ...p,
      documents: documentsPaiement.filter((d) => Number(d.paiement_id) === Number(p.id)),
    })),
    proformas: cleanRows(proformas),
    achat: achatRow ? { ...achatRow, preuves: preuvesAchat } : null,
  };
}

async function getStats() {
  const rows = await getArchivePrisma().$queryRawUnsafe(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN statut = 'rejete' THEN 1 ELSE 0 END) AS rejetees,
      SUM(CASE WHEN statut IN ('paye','achat_effectue','cloture') THEN 1 ELSE 0 END) AS avancees,
      SUM(CASE WHEN statut = 'validation_entite_generale' THEN 1 ELSE 0 END) AS validation_generale
    FROM ${table("demandes_paiement")}
    WHERE deleted_at IS NULL
  `);
  const row = cleanRow(rows?.[0] || {});
  return {
    total: toNumber(row.total),
    rejetees: toNumber(row.rejetees),
    avancees: toNumber(row.avancees),
    validation_generale: toNumber(row.validation_generale),
  };
}

module.exports = {
  listDemandes,
  getDemande,
  getStats,
};
