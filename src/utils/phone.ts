const DIAL_CODES_DESC = ['234', '353', '44', '61', '49', '33', '1'];

export function digitsOnly(input: string): string {
  return input.replace(/\D/g, '');
}

function splitPhoneForEdit(phone: string, defaultDialCode = '1'): { dialCode: string; localDigits: string } {
  const trimmed = phone.trim();
  let digits = digitsOnly(trimmed);

  if (trimmed.startsWith('+') && digits.length > 0) {
    for (const code of DIAL_CODES_DESC) {
      if (digits.startsWith(code)) {
        return { dialCode: code, localDigits: digits.slice(code.length) };
      }
    }
    return { dialCode: defaultDialCode, localDigits: digits };
  }

  if (defaultDialCode === '1' && digits.length === 11 && digits.startsWith('1')) {
    digits = digits.slice(1);
  }

  return { dialCode: defaultDialCode, localDigits: digits };
}

function isUs555Exchange(e164: string): boolean {
  const match = e164.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  return !!match && match[2] === '555';
}

function validateE164(e164: string): { e164: string; error?: string } {
  if (!/^\+\d{8,15}$/.test(e164)) {
    return { e164: '', error: 'Invalid phone number. Use country code + number (E.164).' };
  }
  if (isUs555Exchange(e164)) {
    return {
      e164: '',
      error:
        'US 555 numbers are test/fiction numbers and cannot receive real calls or SMS. Use a real mobile number.',
    };
  }
  return { e164 };
}

function formatToE164(localInput: string, dialCode: string): { e164: string; error?: string } {
  const trimmed = localInput.trim();
  if (!trimmed) return { e164: '', error: 'Phone number is required.' };

  if (trimmed.startsWith('+')) {
    return validateE164(`+${digitsOnly(trimmed)}`);
  }

  let national = digitsOnly(trimmed);

  if (dialCode === '1') {
    if (national.length === 11 && national.startsWith('1')) national = national.slice(1);
    if (national.length !== 10) {
      return { e164: '', error: 'US/Canada numbers need 10 digits (e.g. 720 555 0149).' };
    }
    return validateE164(`+1${national}`);
  }

  if (national.length < 6) {
    return { e164: '', error: 'Phone number is too short for the selected country.' };
  }

  return validateE164(`+${dialCode}${national}`);
}

/** Normalize contact input to E.164 before save or carrier API. */
export function normalizePhoneToE164(phone: string, defaultDialCode = '1'): string {
  const trimmed = phone.trim();
  if (!trimmed) {
    throw new Error('Phone number is required.');
  }

  if (trimmed.startsWith('+')) {
    const result = validateE164(`+${digitsOnly(trimmed)}`);
    if (!result.e164) throw new Error(result.error || 'Invalid phone number.');
    return result.e164;
  }

  const { dialCode, localDigits } = splitPhoneForEdit(trimmed, defaultDialCode);
  const result = formatToE164(localDigits, dialCode);
  if (!result.e164) throw new Error(result.error || 'Invalid phone number.');
  return result.e164;
}
