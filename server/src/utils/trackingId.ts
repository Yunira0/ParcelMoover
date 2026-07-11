import crypto from "crypto";

const PREFIX = "PM";
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const RANDOM_LENGTH = 13;

export function getDatePart(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kathmandu",
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value || "";

  return `${get("year")}${get("month")}${get("day")}`;
}

export function randomBase32(length: number) {
    const bytes = crypto.randomBytes(length);

    return Array.from(bytes)
    .map((byte) => ALPHABET[byte & 31])
    .join("");
}


export function getCheckDigit(input: string) {
  let factor = 2;
  let sum = 0;
  const base = ALPHABET.length;
  

  for (let i = input.length - 1; i >= 0; i--) {
      const char = input[i];
      if (!char) {
        throw new Error("UnExpected characeter")
      }

    const codePoint = ALPHABET.indexOf(char);

    if (codePoint === -1) {
      throw new Error("Invalid tracking ID character");
    }

    let addend = factor * codePoint;
    factor = factor === 2 ? 1 : 2;
    addend = Math.floor(addend / base) + (addend % base);
    sum += addend;
  }

  const remainder = sum % base;
  return ALPHABET[(base - remainder) % base];
}

export function generateTrackingId(date = new Date()) {
  const datePart = getDatePart(date);
  const randomPart = randomBase32(RANDOM_LENGTH);
  const body = `${PREFIX}${datePart}${randomPart}`;
  const checkDigit = getCheckDigit(body);

  return `${PREFIX}-${datePart}-${randomPart}-${checkDigit}`
}

const TRACKING_ID_PATTERN = new RegExp(
  `^${PREFIX}-(\\d{6})-([${ALPHABET}]{${RANDOM_LENGTH}})-([${ALPHABET}])$`,
);

// Format + check-digit validation so the public tracking endpoint can reject
// junk input before it ever reaches Redis or the database - tracking IDs are
// unguessable (13 random base32 chars), but nothing else gates that route.
export function isValidTrackingId(trackingId: string): boolean {
  const match = TRACKING_ID_PATTERN.exec(trackingId);
  if (!match) return false;

  const [, datePart, randomPart, checkDigit] = match;
  const body = `${PREFIX}${datePart}${randomPart}`;

  try {
    return getCheckDigit(body) === checkDigit;
  } catch {
    return false;
  }
}