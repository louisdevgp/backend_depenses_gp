const test = require("node:test");
const assert = require("node:assert/strict");

const { __testables } = require("./qr.services");

const { parseQrToken } = __testables;

test("parseQrToken accepte un QR demandeur signe sur la date de creation", () => {
  const parsed = parseQrToken("GP|demandeur|18d53e2f-b399-4c82-b4a5-b446e8cc9825|2026-07-16T20:49:31.000Z|signature");

  assert.deepEqual(parsed, {
    prefix: "GP",
    type: "demandeur",
    uuid: "18d53e2f-b399-4c82-b4a5-b446e8cc9825",
    finalizedIso: "2026-07-16T20:49:31.000Z",
    sig: "signature",
  });
});

test("parseQrToken refuse les types QR inconnus", () => {
  assert.equal(parseQrToken("GP|unknown|uuid|2026-07-16T20:49:31.000Z|signature"), null);
});
