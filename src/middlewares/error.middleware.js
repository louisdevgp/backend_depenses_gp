module.exports = (err, req, res, next) => {
  console.error("On est ici ", err);
  res.status(500).json({
    message: err.message || "Erreur serveur"
  });
};
