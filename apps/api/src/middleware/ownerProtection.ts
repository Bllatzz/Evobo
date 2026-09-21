export type AdminProtection = "owner_protected" | "admin_protected";

/**
 * Who may take admin power away from whom — used when an account is demoted
 * (POST /roles/assign) or suspended (PATCH /admin/users/:id).
 *
 * - The owner (OWNER_USER_ID) can never be demoted or suspended, by anyone,
 *   themselves included — that's what guarantees the platform can't end up
 *   without an admin.
 * - Any other admin can only be demoted/suspended by the owner. An admin may
 *   still lower their own role.
 * - Non-admin targets aren't protected.
 *
 * With OWNER_USER_ID unset nobody counts as owner, so no admin can be
 * demoted or suspended by another — fails closed rather than open.
 *
 * Returns the error code to answer with, or null when the action is allowed.
 * `ownerId` is passed in (env.OWNER_USER_ID) to keep this function pure.
 */
export function adminProtectionFor(
  ownerId: string | undefined,
  actorId: string,
  target: { id: string; roleName: string },
): AdminProtection | null {
  if (ownerId !== undefined && target.id === ownerId) return "owner_protected";
  const actorIsOwner = ownerId !== undefined && actorId === ownerId;
  if (target.roleName === "admin" && target.id !== actorId && !actorIsOwner) return "admin_protected";
  return null;
}
