function isNumericId(v) {
  return /^\d+$/.test(String(v));
}

function whereIdOrUuid(idOrUuid) {
  if (isNumericId(idOrUuid)) return { id: Number(idOrUuid) };
  return { uuid: String(idOrUuid) };
}

module.exports = { isNumericId, whereIdOrUuid };
