import { expect, it } from "vitest";
import { RequestError } from "@agentclientprotocol/sdk";
import {
  APPROVAL_SEED_META,
  applyApprovalSeed,
  approvalSeedFromMeta,
  DEFAULT_SAFETY,
} from "../safety-settings.js";

const normal = { env: {}, isRoot: false };

it("reads a valid native approval policy seed from session/new _meta", () => {
  expect(approvalSeedFromMeta(undefined)).toBeUndefined();
  expect(approvalSeedFromMeta(null)).toBeUndefined();
  expect(approvalSeedFromMeta({})).toBeUndefined();
  expect(approvalSeedFromMeta({ [APPROVAL_SEED_META]: {} })).toBeUndefined();
  expect(approvalSeedFromMeta({ [APPROVAL_SEED_META]: { policy: "promptUnmatched" } })).toBe(
    "promptUnmatched",
  );
  expect(approvalSeedFromMeta({ [APPROVAL_SEED_META]: { policy: "denyUnmatched" } })).toBe(
    "denyUnmatched",
  );
});

it("rejects a malformed or unknown approval seed rather than dropping it", () => {
  expect(() => approvalSeedFromMeta({ [APPROVAL_SEED_META]: "promptUnmatched" })).toThrow(
    RequestError,
  );
  expect(() => approvalSeedFromMeta({ [APPROVAL_SEED_META]: [] })).toThrow(RequestError);
  expect(() => approvalSeedFromMeta({ [APPROVAL_SEED_META]: { policy: "bogus" } })).toThrow(
    /must be one of/,
  );
  expect(() => approvalSeedFromMeta({ [APPROVAL_SEED_META]: { policy: 7 } })).toThrow(RequestError);
});

it("applies the seed onto safety, leaving other fields default and omitted meta untouched", () => {
  expect(applyApprovalSeed(undefined, undefined, normal)).toBeUndefined();
  expect(applyApprovalSeed(DEFAULT_SAFETY, {}, normal)).toBe(DEFAULT_SAFETY);
  const seeded = applyApprovalSeed(
    undefined,
    { [APPROVAL_SEED_META]: { policy: "promptUnmatched" } },
    normal,
  );
  expect(seeded?.nativeApprovalPolicy).toBe("promptUnmatched");
  expect(seeded?.sandbox).toBe(DEFAULT_SAFETY.sandbox);
  expect(seeded?.shell).toBe(DEFAULT_SAFETY.shell);
});

it("enforces the guard on a broad seed (root may not seed allowAll)", () => {
  expect(() =>
    applyApprovalSeed(
      undefined,
      { [APPROVAL_SEED_META]: { policy: "allowAll" } },
      {
        env: {},
        isRoot: true,
      },
    ),
  ).toThrow(/root/);
  expect(
    applyApprovalSeed(undefined, { [APPROVAL_SEED_META]: { policy: "allowAll" } }, normal)
      ?.nativeApprovalPolicy,
  ).toBe("allowAll");
});
