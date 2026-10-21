import { expect, it } from "vitest";
import { RequestError } from "@agentclientprotocol/sdk";
import {
  APPROVAL_SEED_META,
  PERMISSION_PROFILE_OPTION_ID,
  permissionProfileConfigOption,
  profileSeedFromMeta,
} from "../permission-profile.js";

it("reads a valid permission-profile id from session/new _meta", () => {
  expect(profileSeedFromMeta(undefined)).toBeUndefined();
  expect(profileSeedFromMeta(null)).toBeUndefined();
  expect(profileSeedFromMeta({})).toBeUndefined();
  // policy-only seed keeps today's behaviour: no profile selected
  expect(
    profileSeedFromMeta({ [APPROVAL_SEED_META]: { policy: "promptUnmatched" } }),
  ).toBeUndefined();
  expect(
    profileSeedFromMeta({
      [APPROVAL_SEED_META]: { policy: "promptUnmatched", profile: ":ask-me" },
    }),
  ).toBe(":ask-me");
  // profile is additive: present without a policy is still read
  expect(profileSeedFromMeta({ [APPROVAL_SEED_META]: { profile: ":read-only" } })).toBe(
    ":read-only",
  );
});

it("rejects a malformed seed or a non-string / empty profile rather than dropping it", () => {
  expect(() => profileSeedFromMeta({ [APPROVAL_SEED_META]: "x" })).toThrow(RequestError);
  expect(() => profileSeedFromMeta({ [APPROVAL_SEED_META]: [] })).toThrow(RequestError);
  expect(() => profileSeedFromMeta({ [APPROVAL_SEED_META]: { profile: "" } })).toThrow(
    /non-empty permission-profile id/,
  );
  expect(() => profileSeedFromMeta({ [APPROVAL_SEED_META]: { profile: 7 } })).toThrow(RequestError);
  expect(() => profileSeedFromMeta({ [APPROVAL_SEED_META]: { profile: null } })).toThrow(
    RequestError,
  );
});

it("builds a read-back option whose currentValue is the committed id", () => {
  expect(permissionProfileConfigOption(undefined)).toBeUndefined();
  expect(permissionProfileConfigOption(null)).toBeUndefined();
  const option = permissionProfileConfigOption(":ask-me");
  expect(option?.id).toBe(PERMISSION_PROFILE_OPTION_ID);
  expect(option?.category).toBe("safety");
  expect(option?.type).toBe("select");
  expect(option?.currentValue).toBe(":ask-me");
  // with no catalog, the single option is the current value itself
  expect((option as { options: unknown }).options).toEqual([{ value: ":ask-me", name: ":ask-me" }]);
});

it("lists the live host catalog rows and keeps an off-catalog current value selectable", () => {
  // The live 1.4.11 catalog rows (A1 probe: reports/profile-probe/list-live.jsonl).
  const catalog = [
    { profileId: ":read-only", label: "Read only", available: true, reviewerAuthority: "human" },
    { profileId: ":ask-me", label: "Ask me", available: true, reviewerAuthority: "human" },
    {
      profileId: ":auto-review",
      label: "Auto-review",
      available: true,
      reviewerAuthority: "autoReview",
    },
    {
      profileId: ":unrestricted",
      label: "Unrestricted",
      available: true,
      reviewerAuthority: "none",
    },
  ];
  const option = permissionProfileConfigOption(":ask-me", catalog);
  expect((option as { options: unknown }).options).toEqual([
    { value: ":read-only", name: "Read only" },
    { value: ":ask-me", name: "Ask me" },
    { value: ":auto-review", name: "Auto-review" },
    { value: ":unrestricted", name: "Unrestricted" },
  ]);
  // unavailable rows are dropped; an off-catalog committed id is still selectable
  const narrowed = permissionProfileConfigOption(":custom", [
    { profileId: ":ask-me", label: "Ask me", available: true },
    { profileId: ":hidden", label: "Hidden", available: false },
  ]);
  expect((narrowed as { options: unknown }).options).toEqual([
    { value: ":custom", name: ":custom" },
    { value: ":ask-me", name: "Ask me" },
  ]);
});
