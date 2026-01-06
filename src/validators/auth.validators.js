const { z } = require("zod");

const registerSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(8),
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
    newPassword: z.string().min(8),
  }),
  params: z.object({}),
  query: z.object({}),
});

module.exports = {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
};
