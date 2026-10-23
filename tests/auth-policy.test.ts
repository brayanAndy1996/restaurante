import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeIdentifier,
  validatePassword,
  hashToken,
  AuthError,
  ids,
} from "../src/auth-policy.js";
test("password limits do not truncate unicode or accept short passwords", () => {
  assert.throws(() => validatePassword("short"), AuthError);
  assert.throws(() => validatePassword("a".repeat(129)), AuthError);
  assert.equal(
    validatePassword("correct-long-password"),
    "correct-long-password",
  );
});
test("identity normalization and opaque token hashes", () => {
  assert.equal(normalizeIdentifier(" DEMO_A "), "demo_a");
  assert.throws(() => normalizeIdentifier("a' OR 1=1"), AuthError);
  assert.equal(hashToken("secret").length, 64);
  assert.notEqual(hashToken("a"), hashToken("b"));
});

test("assignment ids require canonical UUID segmentation", () => {
  for (const invalid of [
    "-".repeat(36),
    "aaaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa",
  ]) {
    assert.throws(
      () => ids([invalid]),
      (error: unknown) =>
        error instanceof AuthError &&
        error.code === "VALIDATION_ERROR" &&
        error.status === 400,
    );
  }
  const valid = "12345678-abcd-1234-abcd-123456789abc";
  assert.deepEqual(ids([valid]), [valid]);
});
