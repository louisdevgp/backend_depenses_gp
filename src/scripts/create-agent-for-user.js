const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function createAgentForUser() {
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

    // Vérifier si un agent existe déjà pour cet utilisateur
    const existingAgent = await prisma.agents.findFirst({
      where: {
        user_id: user.id
      }
    });

    if (existingAgent) {
      console.log('Un agent existe déjà pour cet utilisateur:', existingAgent);
      return;
    }

    // Créer un agent pour l'utilisateur
    const agent = await prisma.agents.create({
      data: {
        user_id: user.id,
        nom: user.nom || 'Dimitris',
        prenom: user.prenom || 'User',
        email: user.email,
        telephone: user.telephone || '',
        adresse: user.adresse || '',
        poste: 'DAF',
        statut: 'ACTIF',
        // Vous pouvez ajouter d'autres champs selon vos besoins
        // comme direction_id, departement_id, etc.
      }
    });

    console.log('Agent créé avec succès:', agent);

    // Maintenant, assurez-vous que l'utilisateur a le rôle DAF
    const dafRole = await prisma.roles.findFirst({
      where: {
        role_name: 'DAF'
      }
    });

    if (dafRole) {
      // Associer le rôle DAF à l'utilisateur
      await prisma.userRoles.upsert({
        where: {
          user_id_role_id: {
            user_id: user.id,
            role_id: dafRole.id
          }
        },
        update: {},
        create: {
          user_id: user.id,
          role_id: dafRole.id
        }
      });

      console.log('Rôle DAF assigné à l\'utilisateur');
    } else {
      console.log('Rôle DAF non trouvé dans la base de données');
    }

  } catch (error) {
    console.error('Erreur lors de la création de l\'agent:', error);
  } finally {
    await prisma.$disconnect();
  }
}

createAgentForUser()
  .then(() => {
    console.log('Opération terminée');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Erreur:', error);
    process.exit(1);
  });