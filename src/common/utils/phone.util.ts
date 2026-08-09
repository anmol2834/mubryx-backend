/**
 * Validates and normalizes an Indian phone number.
 * Returns the normalized 10-digit string, or null if invalid.
 */
export function normalizeIndianPhoneNumber(phone: string): string | null {
  if (!phone) return null;
  // Remove all non-digit characters
  const digits = phone.replace(/\D/g, '');

  // Extract the last 10 digits (ignoring +91, 0, or 91 prefixes)
  let normalized = digits;
  if (digits.length > 10) {
    normalized = digits.slice(-10);
  }

  // Validate it's exactly 10 digits and starts with 6-9
  if (normalized.length === 10 && /^[6-9]/.test(normalized)) {
    return normalized;
  }

  return null;
}
