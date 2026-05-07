import { franc } from 'franc';
import langs from 'langs';

const MIN_TEXT_LENGTH = 12;
const DUTCH_CODES = new Set(['nl', 'nld', 'dut']);

export type DetectedLanguage = {
  name: string;
  iso2?: string;
};

export function detectLanguageFromText(text: string): DetectedLanguage | null {
  const cleaned = text?.trim();
  if (!cleaned || cleaned.length < MIN_TEXT_LENGTH) {
    return null;
  }

  const iso3 = franc(cleaned, { minLength: MIN_TEXT_LENGTH });
  if (!iso3 || iso3 === 'und') {
    return null;
  }

  const langInfo = langs.where('3', iso3) || langs.where('2T', iso3) || langs.where('1', iso3);
  if (!langInfo) {
    return null;
  }

  const iso2 = (langInfo['1'] || langInfo['2T'] || langInfo['2B']) as string | undefined;
  return {
    name: langInfo.name,
    iso2,
  };
}

export function isDutchLanguage(code?: string, name?: string) {
  const normalizedCode = code?.toLowerCase();
  if (normalizedCode && DUTCH_CODES.has(normalizedCode)) {
    return true;
  }
  const normalizedName = name?.toLowerCase() || '';
  return normalizedName.includes('dutch') || normalizedName.includes('flemish');
}
