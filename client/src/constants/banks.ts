// Banks and financial institutions a vendor's COD payouts can be sent to, with
// each one's bank code. The name is stored verbatim as the vendor's bank_name;
// the code is looked up from it, so edit with care.
export interface BankInfo {
  code: string;
  name: string;
}

export const BANKS: readonly BankInfo[] = [
  { code: '0301', name: 'Agricultural Development Bank Ltd.' },
  { code: '7516', name: 'Best Finance Company Ltd.' },
  { code: '9906', name: 'Central Finance Ltd' },
  { code: '2001', name: 'Citizens Bank International Limited' },
  { code: '1001', name: 'Everest Bank Limited' },
  { code: '7502', name: 'Excel Development Bank Ltd.' },
  { code: '6601', name: 'Garima Bikas Bank Limited' },
  { code: '1901', name: 'Global IME Bank Limited' },
  { code: '9001', name: 'Goodwill Finance Limited' },
  { code: '7517', name: 'Green Development Bank Ltd.' },
  { code: '9915', name: 'Guheswori Merchant Banking and Finance Limited' },
  { code: '8301', name: 'Gurkhas Finance Limited' },
  { code: '0701', name: 'Himalayan Bank Limited' },
  { code: '9919', name: 'ICFC Finance Limited' },
  { code: '6001', name: 'Jyoti Bikash Bank Ltd' },
  { code: '6801', name: 'Kamana Sewa Bikas Bank Ltd.' },
  { code: '1601', name: 'Kumari Bank Ltd.' },
  { code: '2201', name: 'Laxmi Sunrise Bank Limited' },
  { code: '5401', name: 'Lumbini Bikas Bank Limited' },
  { code: '1501', name: 'Machhapuchchhre Bank Limited' },
  { code: '9931', name: 'Mahalaxmi Bikas Bank Ltd.' },
  { code: '9935', name: 'Manjushree Finance Limited' },
  { code: '2301', name: 'NIC Asia Bank Limited' },
  { code: '7509', name: 'Miteri Development Bank Limited' },
  { code: '7201', name: 'Muktinath Bikas Bank Limited' },
  { code: '0401', name: 'Nabil Bank Ltd.' },
  { code: '0101', name: 'Nepal Bank Limited' },
  { code: '0501', name: 'Nepal Investment Mega Bank Limited' },
  { code: '0801', name: 'Nepal SBI Bank Limited' },
  { code: '2501', name: 'NMB Bank Limited' },
  { code: '9905', name: 'Pokhara Finance Ltd.' },
  { code: '2601', name: 'Prabhu Bank Limited' },
  { code: '2101', name: 'Prime Commercial Bank Limited' },
  { code: '9902', name: 'Progressive Finance Co. Ltd.' },
  { code: '201', name: 'Rastriya Banijya Bank Limited' },
  { code: '9939', name: 'Reliance Finance Ltd.' },
  { code: '9911', name: 'Samriddhi Finance Company Ltd.' },
  { code: '4501', name: 'Sanima Bank Ltd.' },
  { code: '5901', name: 'Saptakoshi Development Bank Ltd.' },
  { code: '7301', name: 'Shangrila Development Bank Limited' },
  { code: '8101', name: 'Shine Resunga Development Bank Ltd.' },
  { code: '9201', name: 'Shree Investment & Finance Co. Ltd.' },
  { code: '1801', name: 'Siddhartha Bank Limited' },
  { code: '601', name: 'Standard Chartered Bank Nepal Limited' },
  { code: '9908', name: 'Corporate Development Bank Ltd.' },
  { code: '7604', name: 'Janaki Finance Ltd.' },
  { code: '7607', name: 'Multipurpose Finance Limited' },
  { code: '7605', name: 'Narayani Development Bank Limited' },
  { code: '7701', name: 'Nepal Finance Limited' },
  { code: '7518', name: 'Nepal Infrastucture Bank Ltd.' },
  { code: '7608', name: 'Salapa Bikas Bank Limited' },
  { code: '6401', name: 'Sindhu Bikash Bank Ltd.' },
];

/** Bank code for a stored bank name, or '' if the name isn't in the list. */
export const bankCodeFor = (name: string): string =>
  BANKS.find((b) => b.name === name)?.code ?? '';
