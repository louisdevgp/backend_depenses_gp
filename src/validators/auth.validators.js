const { z } = require("zod");

const strongPassword = z
  .string()
  .min(8)
  .regex(/[A-Z]/, "Mot de passe: au moins une majuscule")
  .regex(/[a-z]/, "Mot de passe: au moins une minuscule")
  .regex(/[0-9]/, "Mot de passe: au moins un chiffre")
  .regex(/[^A-Za-z0-9]/, "Mot de passe: au moins un caractère spécial");

const registerSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: strongPassword,
    nom: z.string().min(1).optional(),
    prenom: z.string().min(1).optional(),
    // optionnel: créer un agent en même temps
    agent: z
      .object({
        nom: z.string().min(1),
        prenom: z.string().min(1),
        matricule: z.string().min(1).optional(),
        direction_id: z.number().int().positive().optional(),
        departement_id: z.number().int().positive().optional(),
        service_id: z.number().int().positive().optional(),
      })
      .optional(),
  }),
  params: z.object({}),
  query: z.object({}),
});

const loginSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(1),
  }),
  params: z.object({}),
  query: z.object({}),
});

const forgotPasswordSchema = z.object({
  body: z.object({
    email: z.string().email(),
  }),
  params: z.object({}),
  query: z.object({}),
});

const resetPasswordSchema = z.object({
  body: z.object({
    token: z.string().min(10),
    newPassword: strongPassword,
  }),
  params: z.object({}),
  query: z.object({}),
});

const changePasswordSchema = z.object({
  body: z.object({
    oldPassword: z.string().min(1),
    newPassword: strongPassword,
  }),
  params: z.object({}),
  query: z.object({}),
});

module.exports = {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
};
