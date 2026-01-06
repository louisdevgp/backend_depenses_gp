function pad(n, width = 4) {
  const s = String(n);
  return s.length >= width ? s : "0".repeat(width - s.length) + s;
}

// BC-20251223-0001
async function generateBonCommandeNumero(prisma) {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const prefix = `BC-${yyyy}${mm}${dd}-`;

  // Compte combien existent déjà aujourd’hui
  const count = await prisma.bons_commande.count({
    where: { numero: { startsWith: prefix } },
  });

  return `${prefix}${pad(count + 1, 4)}`;
}

module.exports = { generateBonCommandeNumero };
