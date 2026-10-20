import { nativePolicyAvailability } from "./availability.js";
import { RequestError, type SessionConfigOption } from "@agentclientprotocol/sdk";
import type { ModeGuardContext } from "./modes.js";

export const NATIVE_POLICIES = [
  "onRequest",
  "promptUnmatched",
  "denyUnmatched",
  "allowAll",
] as const;

/**
 * ACP `_meta` key a client may set on `session/new`, `session/load` and
 * `session/resume` to SEED the native approval policy at creation, so the
 * policy is in force for the FIRST prompt without a separate
 * `session/set_config_option` round trip. The returned `configOptions` already
 * reflect it (read-back). Shape: `{ "muse/approval": { policy: <NativePolicy> } }`.
 * Any other policy spelling is rejected with invalid params; omitting the key
 * leaves the default (`onRequest`) untouched. Additive and backend-agnostic:
 * exec ignores native policy at spawn, but the read-back stays coherent.
 */
export const APPROVAL_SEED_META = "muse/approval";

/**
 * Read a seeded native approval policy out of a `session/new`-style `_meta`.
 * Returns undefined when the client supplied none. Throws invalid params for a
 * malformed shape or an unknown policy so a seed is never silently dropped.
 */
export function approvalSeedFromMeta(
  meta: Record<string, unknown> | null | undefined,
): (typeof NATIVE_POLICIES)[number] | undefined {
  const raw = meta?.[APPROVAL_SEED_META];
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw))
    throw RequestError.invalidParams(
      undefined,
      `${APPROVAL_SEED_META} seed must be an object { policy: <native approval policy> }`,
    );
  const policy = (raw as Record<string, unknown>).policy;
  if (policy === undefined) return undefined;
  if (typeof policy !== "string" || !(NATIVE_POLICIES as readonly string[]).includes(policy))
    throw RequestError.invalidParams(
      undefined,
      `${APPROVAL_SEED_META}.policy must be one of ${NATIVE_POLICIES.join(", ")}`,
    );
  return policy as (typeof NATIVE_POLICIES)[number];
}

/**
 * Apply a `_meta` approval-policy seed onto a session's initial safety, after
 * validating it under the guard (root may not seed `allowAll`). The seed only
 * sets `nativeApprovalPolicy`; every other safety field keeps its default.
 */
export function applyApprovalSeed(
  current: SafetySettings | undefined,
  meta: Record<string, unknown> | null | undefined,
  guard: ModeGuardContext,
): SafetySettings | undefined {
  const policy = approvalSeedFromMeta(meta);
  if (policy === undefined) return current;
  return selectSafety(current, "nativeApprovalPolicy", policy, guard);
}
export interface SafetySettings {
  nativeApprovalPolicy: (typeof NATIVE_POLICIES)[number];
  sandbox: "enabled" | "disabled";
  sandboxNetwork: "proxy-only" | "restricted" | "enabled";
  workspaceWrite: "enabled" | "disabled";
  shell: "enabled" | "disabled";
}
export const DEFAULT_SAFETY: SafetySettings = {
  nativeApprovalPolicy: "onRequest",
  sandbox: "enabled",
  sandboxNetwork: "proxy-only",
  workspaceWrite: "enabled",
  shell: "enabled",
};
const choices = {
  nativeApprovalPolicy: NATIVE_POLICIES,
  sandbox: ["enabled", "disabled"],
  sandboxNetwork: ["proxy-only", "restricted", "enabled"],
  workspaceWrite: ["enabled", "disabled"],
  shell: ["enabled", "disabled"],
} as const;
export function isSafetyConfig(id: string): id is keyof SafetySettings {
  return Object.hasOwn(choices, id);
}
export function validSafety(value: unknown): value is SafetySettings {
  return (
    !!value &&
    typeof value === "object" &&
    Object.entries(choices).every(([key, values]) =>
      (values as readonly unknown[]).includes((value as Record<string, unknown>)[key]),
    )
  );
}
export function assertSafetyGuard(safety: SafetySettings, guard: ModeGuardContext): void {
  if (
    (safety.sandbox === "disabled" ||
      safety.sandboxNetwork === "enabled" ||
      safety.nativeApprovalPolicy === "allowAll") &&
    guard.isRoot
  )
    throw RequestError.invalidParams(
      undefined,
      "Broader SDK safety settings are unavailable as root; use the default sandbox and onRequest policy",
    );
  if (safety.sandbox === "disabled" && guard.env.MUSE_CODE_ACP_ALLOW_YOLO !== "1")
    throw RequestError.invalidParams(
      undefined,
      "Disabling the SDK sandbox requires MUSE_CODE_ACP_ALLOW_YOLO=1; approval bypass alone keeps the sandbox enabled",
    );
}
export function selectSafety(
  current: SafetySettings | undefined,
  id: keyof SafetySettings,
  value: unknown,
  guard: ModeGuardContext,
): SafetySettings {
  const selected = { ...DEFAULT_SAFETY, ...current, [id]: value };
  if (!validSafety(selected))
    throw RequestError.invalidParams(
      undefined,
      `Invalid SDK safety selection ${id}: ${String(value)}`,
    );
  assertSafetyGuard(selected, guard);
  return selected;
}
export function safetyArgs(safety: SafetySettings = DEFAULT_SAFETY, readOnly = false): string[] {
  return [
    ...(safety.sandbox === "disabled" ? ["--disable-sandbox"] : []),
    ...(safety.sandboxNetwork !== "proxy-only" ? ["--sandbox-network", safety.sandboxNetwork] : []),
    ...(readOnly || safety.workspaceWrite === "disabled" ? ["--disable-write"] : []),
    ...(readOnly || safety.shell === "disabled" ? ["--disable-shell"] : []),
  ];
}
export function safetyConfigOptions(
  current: SafetySettings | undefined,
  guard: ModeGuardContext,
  hostVersion?: string | null,
): SessionConfigOption[] {
  const safety = current ?? DEFAULT_SAFETY;
  const names: Record<keyof SafetySettings, string> = {
    nativeApprovalPolicy: "Native approval policy",
    sandbox: "OS sandbox",
    sandboxNetwork: "Sandbox network",
    workspaceWrite: "Non-shell workspace writes",
    shell: "Workspace shell",
  };
  return Object.entries(choices).map(([id, values]) => ({
    id,
    name: names[id as keyof SafetySettings],
    type: "select",
    currentValue: safety[id as keyof SafetySettings],
    description:
      id === "nativeApprovalPolicy"
        ? "Requested Muse policy, separate from adapter automatic decisions. Non-default policies require verified Muse 1.2.1+ enforcement. Changes apply to the next idle host."
        : "Fixed for the host lifetime. Changing this setting replaces an idle host; it does not trust workspace rules or change approval decisions.",
    options: values
      .filter((value) => {
        if (
          id === "nativeApprovalPolicy" &&
          !nativePolicyAvailability(value, hostVersion).available
        )
          return false;
        try {
          selectSafety(safety, id as keyof SafetySettings, value, guard);
          return true;
        } catch {
          return false;
        }
      })
      .map((value) => ({ value, name: value })),
  }));
}
