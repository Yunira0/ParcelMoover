import { getDatePart, randomBase32, getCheckDigit } from "./trackingId";

const PREFIX = "RTM";
const RANDOM_LENGTH = 10;

export function generateReturnManifestNo(date = new Date()) {
  const datePart = getDatePart(date);
  const randomPart = randomBase32(RANDOM_LENGTH);
  const body = `${PREFIX}${datePart}${randomPart}`;
  const checkDigit = getCheckDigit(body);

  return `${PREFIX}-${datePart}-${randomPart}-${checkDigit}`;
}
