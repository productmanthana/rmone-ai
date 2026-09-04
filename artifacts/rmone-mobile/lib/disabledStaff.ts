/** A reactivation target is valid only when its own tenant is known.
 * Deliberately never substitute the viewing user's tenant: superadmins can
 * inspect staff from a different tenant. */
export function canReactivateDisabledStaff(
  enabled: boolean | undefined,
  userGuid: string | undefined,
  tenantId: string | undefined,
  canManageStaff: boolean,
): boolean {
  return enabled === false && canManageStaff && !!userGuid?.trim() && !!tenantId?.trim();
}