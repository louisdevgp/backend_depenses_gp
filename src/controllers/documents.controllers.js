const documentsService = require("../services/documents.services");
const prisma = require("../config/prisma");
// const { serializeBigInt } = require("../utils/jsonBigInt.utils");
const { jsonSafe } = require("../utils/jsonSafe");
const notifications = require("../services/notifications.services");

function isNumericId(v) {
  return v !== null && v !== undefined && v !== "" && /^[0-9]+$/.test(String(v));
}

async function resolveDemandeIdFromBody(body) {
  if (isNumericId(body?.demande_id)) return Number(body.demande_id);

  if (isNumericId(body?.bon_commande_id)) {
    const bc = await prisma.bons_commande.findUnique({
      where: { id: Number(body.bon_commande_id) },
      select: { demande_id: true },
    });
    if (bc?.demande_id) return Number(bc.demande_id);
  }

  if (isNumericId(body?.reception_id)) {
    const r = await prisma.receptions.findUnique({
      where: { id: Number(body.reception_id) },
      select: { demande_id: true },
    });
    if (r?.demande_id) return Number(r.demande_id);
  }

  if (isNumericId(body?.paiement_id)) {
    const p = await prisma.paiements.findUnique({
      where: { id: Number(body.paiement_id) },
      select: { demande_id: true },
    });
    if (p?.demande_id) return Number(p.demande_id);
  }

  return null;
}

async function resolveDemandeIdFromDoc(doc) {
  if (!doc) return null;
  if (doc.demande_id) return Number(doc.demande_id);

  if (doc.bon_commande_id) {
    const bc = await prisma.bons_commande.findUnique({
      where: { id: Number(doc.bon_commande_id) },
      select: { demande_id: true },
    });
    if (bc?.demande_id) return Number(bc.demande_id);
  }

  if (doc.reception_id) {
    const r = await prisma.receptions.findUnique({
      where: { id: Number(doc.reception_id) },
      select: { demande_id: true },
    });
    if (r?.demande_id) return Number(r.demande_id);
  }

  if (doc.paiement_id) {
    const p = await prisma.paiements.findUnique({
      where: { id: Number(doc.paiement_id) },
      select: { demande_id: true },
    });
    if (p?.demande_id) return Number(p.demande_id);
  }

  return null;
}

async function resolveUserIdsForDemandeContext({ demandeId, excludeUserId = null }) {
  if (!demandeId) return { demandeurUserId: null, currentValidatorUserId: null };

  const demande = await prisma.demandes_paiement.findUnique({
    where: { id: Number(demandeId) },
    select: {
      id: true,
      uuid: true,
      agents_demandes_paiement_demandeur_idToagents: { select: { users: { select: { id: true } } } },
    },
  });

  const demandeurUserId = demande?.agents_demandes_paiement_demandeur_idToagents?.users?.id || null;

  const current = await prisma.validation_steps.findFirst({
    where: { demande_id: Number(demandeId), status: "en_attente" },
    orderBy: { level: "asc" },
    select: { validator_id: true, role_name: true, level: true },
  });

  let currentValidatorUserId = null;
  if (current?.validator_id) {
    const a = await prisma.agents.findUnique({
      where: { id: Number(current.validator_id) },
      select: { users: { select: { id: true } } },
    });
    currentValidatorUserId = a?.users?.id || null;
  }

  const uniq = (arr) => Array.from(new Set(arr.filter(Boolean)));
  const recipients = uniq([demandeurUserId, currentValidatorUserId]).filter((id) => Number(id) !== Number(excludeUserId));

  return { demande, demandeurUserId, currentValidatorUserId, recipients, current };
}

exports.uploadMany = async (req, res) => {
  try {
    const userId = req.user.userId;

    const agent = await prisma.agents.findFirst({
      where: { user_id: userId, deleted_at: null },
    });

    if (!agent) {
      return res.status(400).json({
        success: false,
        message: "Agent non trouvé pour l'utilisateur connecté",
      });
    }

    const files = req.files || [];
    if (!files.length) throw new Error("Aucun fichier reçu (champ 'files')");

    const docs = await documentsService.createDocumentsFromUploads({
      files,
      body: req.body,
      upload_by_id: agent.id,
    });

    // Notifications after commit (emails non-bloquants)
    try {
      const demandeId = await resolveDemandeIdFromBody(req.body);

      let excludeUserId = null;
      const uploader = await prisma.agents.findUnique({
        where: { id: Number(agent.id) },
        select: { users: { select: { id: true } } },
      });
      excludeUserId = uploader?.users?.id || null;

      const ctx = await resolveUserIdsForDemandeContext({ demandeId, excludeUserId });

      if (ctx?.recipients?.length) {
        const count = Array.isArray(docs) ? docs.length : 0;
        const typeDoc = req.body?.type_document || "document";

        await Promise.allSettled(
          ctx.recipients.map((uid) =>
            notifications.createNotification({
              user_id: uid,
              type: "document_uploaded",
              demande_id: demandeId,
              message: `${count} document(s) ajouté(s) à la demande (${typeDoc}).`,
              meta: {
                demandeUuid: ctx?.demande?.uuid,
                type_document: typeDoc,
                count,
                documentIds: (docs || []).map((d) => d.id),
                demande_id: demandeId,
                bon_commande_id: isNumericId(req.body?.bon_commande_id) ? Number(req.body.bon_commande_id) : null,
                reception_id: isNumericId(req.body?.reception_id) ? Number(req.body.reception_id) : null,
                paiement_id: isNumericId(req.body?.paiement_id) ? Number(req.body.paiement_id) : null,
              },
              sendEmailNow: true,
            })
          )
        );
      }
    } catch {
      // ignore notifications errors
    }

    res.json({ success: true, data: jsonSafe(docs) });
  } catch (e) {
    return res.status(400).json({ success: false, message: e.message });
  }
};

exports.list = async (req, res) => {
  try {
    const docs = await documentsService.listDocuments(req.query); 
    res.json({ success: true, data: jsonSafe(docs) });
  } catch (e) {
    return res.status(400).json({ success: false, message: e.message });
  }

};

exports.getById = async (req, res) => { 
  try {
    const doc = await documentsService.getDocumentById(req.params.id);
    if (!doc) {
      return res.status(404).json({ success: false, message: "Document not found" });
    }
    res.json({ success: true, data: jsonSafe(doc) });
  } catch (e) {
    return res.status(400).json({ success: false, message: e.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const doc = await documentsService.getDocumentById(req.params.id);
    await documentsService.deleteDocument(req.params.id);

    // Notifications after commit (emails non-bloquants)
    try {
      const demandeId = await resolveDemandeIdFromDoc(doc);
      if (demandeId) {
        const userId = req.user?.userId;
        const actor = userId
          ? await prisma.agents.findFirst({
              where: { user_id: Number(userId), deleted_at: null },
              select: { users: { select: { id: true } } },
            })
          : null;
        const excludeUserId = actor?.users?.id || null;

        const ctx = await resolveUserIdsForDemandeContext({ demandeId, excludeUserId });
        if (ctx?.recipients?.length) {
          await Promise.allSettled(
            ctx.recipients.map((uid) =>
              notifications.createNotification({
                user_id: uid,
                type: "document_deleted",
                demande_id: demandeId,
                message: `Un document a été supprimé de la demande (${doc.type_document || "document"}).`,
                meta: {
                  demandeUuid: ctx?.demande?.uuid,
                  documentId: doc.id,
                  type_document: doc.type_document,
                  nom_fichier: doc.nom_fichier,
                  demande_id: demandeId,
                  bon_commande_id: doc.bon_commande_id ? Number(doc.bon_commande_id) : null,
                  reception_id: doc.reception_id ? Number(doc.reception_id) : null,
                  paiement_id: doc.paiement_id ? Number(doc.paiement_id) : null,
                },
                sendEmailNow: true,
              })
            )
          );
        }
      }
    } catch {
      // ignore notifications errors
    }

    res.json({ success: true, message: "Document deleted" });
  } catch (e) {
    return res.status(400).json({ success: false, message: e.message });
  }
};


