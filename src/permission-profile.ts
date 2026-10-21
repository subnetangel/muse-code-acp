import { RequestError, type SessionConfigOption } from "@agentclientprotocol/sdk";

/**
 * The native permission-profile seam (amendment 42624 FR-42624-1). It rides the
 * SAME `_meta` extension as the approval-policy seam (`muse/approval`) but names
 * a profile the host catalog already admits — the rows `permissionProfile/list`
 * serves — not an approval policy. Selecting the host's `:ask-me` profile
 * attaches a `human` reviewer so a session-mounted MCP tool call draws a real
 * `session/request_permission`, which the default `:auto-review` profile's
 * reviewer clears without ever reaching the ACP client.
 *
 * Seed shape (additive to the policy seed):
 *   _meta { "muse/approval": { policy: <NativePolicy>, profile: "<profileId>" } }
 * `profile` is OPTIONAL: a client that sends only `policy` keeps today's
 * behaviour (the host's configured default profile). A `profile` that is not a
 * non-empty string is rejected with invalid params BEFORE the session is
 * created, exactly as a bad `policy` is.
 *
 * The selection travels to the host as `permissionProfile` on `client.startSession`
 * (and `client.resumeSession` on the load/resume paths) with
 * `requirePermissionProfile: true`, so the adapter PROVES the committed selection
 * equals the request and fails closed — a mismatch or an unknown/unavailable id
 * surfaces as a `session/new` error, never a silent fall back to the host default.
 */
export const APPROVAL_SEED_META = "muse/approval";

/** The config-option id the read-back is published under (beside `nativeApprovalPolicy`). */
export const PERMISSION_PROFILE_OPTION_ID = "nativePermissionProfile";

/** One row of the host permission-profile catalog, as `permissionProfile/list` serves it. */
export interface PermissionProfileRow {
  profileId: string;
  label?: string;
  description?: string | null;
  available?: boolean;
  unavailableReasons?: string[];
  reviewerAuthority?: string;
}

/**
 * Read a seeded permission-profile id out of a `session/new`-style `_meta`.
 * Returns undefined when the client supplied none (key or `profile` absent).
 * Throws invalid params for a malformed seed shape or a `profile` that is not a
 * non-empty string, so a seeded selection is never silently dropped.
 */
export function profileSeedFromMeta(
  meta: Record<string, unknown> | null | undefined,
): string | undefined {
  const raw = meta?.[APPROVAL_SEED_META];
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw))
    throw RequestError.invalidParams(
      undefined,
      `${APPROVAL_SEED_META} seed must be an object { policy?, profile? }`,
    );
  const profile = (raw as Record<string, unknown>).profile;
  if (profile === undefined) return undefined;
  if (typeof profile !== "string" || profile.length === 0)
    throw RequestError.invalidParams(
      undefined,
      `${APPROVAL_SEED_META}.profile must be a non-empty permission-profile id`,
    );
  return profile;
}

/**
 * The read-back config option for the committed permission profile. `currentValue`
 * is the id in force for the session (the seeded request until the host commits a
 * change, then the host's committed `permissionState.profileId` re-emitted on
 * `session/permissionProfileChanged`). `options` lists the host catalog rows when
 * known; absent rows yield an option with only the current value so the read-back
 * is always coherent.
 */
export function permissionProfileConfigOption(
  currentValue: string | null | undefined,
  catalog?: readonly PermissionProfileRow[],
): SessionConfigOption | undefined {
  if (currentValue == null) return undefined;
  const rows = (catalog ?? []).filter((row) => row.available !== false);
  const options = rows.length
    ? rows.map((row) => ({ value: row.profileId, name: row.label ?? row.profileId }))
    : [{ value: currentValue, name: currentValue }];
  if (!options.some((option) => option.value === currentValue))
    options.unshift({ value: currentValue, name: currentValue });
  return {
    id: PERMISSION_PROFILE_OPTION_ID,
    name: "Native permission profile",
    category: "safety",
    type: "select",
    currentValue,
    description:
      "The host permission profile selected for this session. Ask me attaches a human " +
      "reviewer so session-mounted MCP tool calls draw a permission request; the host " +
      "default (Auto-review) clears them without one. Proven at session start; a profile " +
      "the catalog does not admit fails the session rather than falling back to the default.",
    options,
  };
}
