const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function restoreAgent() {
  try {
    // Trouver l'utilisateur existant
    const user = await prisma.users.findUnique({
      where: {
        email: 'dimitris@greenpayci.com'
      }
    });

    if (!user) {
      console.log('Utilisateur dimitris@greenpayci.com non trouvé');
      return;
    }

    // Trouver l'agent supprimé pour cet utilisateur
    const deletedAgent = await prisma.agents.findFirst({
      where: {
        user_id: user.id,
        deleted_at: { not: null } // Trouver les agents qui ont été soft deleted
      }
    });

    if (deletedAgent) {
      // Restaurer l'agent en supprimant la date de suppression
      const restoredAgent = await prisma.agents.update({
        where: {
          id: deletedAgent.id
        },
        data: {
          deleted_at: null // Supprimer la date de suppression
        }
      });

      console.log('Agent restauré avec succès:', restoredAgent);
    } else {
      console.log('Aucun agent supprimé trouvé pour cet utilisateur');
      
      // Vérifier s'il y a un agent actif
      const activeAgent = await prisma.agents.findFirst({
        where: {
          user_id: user.id,
          deleted_at: null
        }
      });
      
      if (activeAgent) {
        console.log('Agent actif trouvé:', activeAgent);
      } else {
        console.log('Aucun agent trouvé pour cet utilisateur (ni actif, ni supprimé)');
      }
    }

  } catch (error) {
    console.error('Erreur lors de la restauration de l\'agent:', error);
  } finally {
    await prisma.$disconnect();
  }
}

restoreAgent()
  .then(() => {
    console.log('Opération terminée');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Erreur:', error);
    process.exit(1);
  });