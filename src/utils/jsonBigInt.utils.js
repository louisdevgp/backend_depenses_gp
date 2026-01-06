function serializeBigInt(obj) {
  return JSON.parse(
    JSON.stringify(obj, (_k, v) => (typeof v === "bigint" ? v.toString() : v))
  );
}

module.exports = { serializeBigInt };
