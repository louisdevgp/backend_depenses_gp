module.exports = (schema) => (req, res, next) => {
  try {
    const parsed = schema.parse({
      body: req.body,
      params: req.params,
      query: req.query,
    });
    req.validated = parsed;
    next();
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: "Validation error",
      errors: err.errors || err,
    });
  }
};
