const FINANCIAL_RECORD_FIELDS = new Set([
  "ContractValue",
  "LaborContractAmount",
]);

export function isFinancialRecordField(fieldName: string): boolean {
  return FINANCIAL_RECORD_FIELDS.has(fieldName);
}

/**
 * Selects the matching server verdict for the field being edited.
 * Financial-only access is intentionally valid even when canEditData is false.
 */
export function canOpenRecordEditModal(
  fieldName: string,
  permissions: { canEditData: boolean; canEditFinancials: boolean },
): boolean {
  return isFinancialRecordField(fieldName)
    ? permissions.canEditFinancials
    : permissions.canEditData;
}