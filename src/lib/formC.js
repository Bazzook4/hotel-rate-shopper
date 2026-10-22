/**
 * Form C's fields, shared by the server and the Form C page. No server
 * imports, so the browser can load it.
 */

export const FORM_C_PURPOSES = [
  { id: 'tourism', label: 'Tourism' },
  { id: 'business', label: 'Business' },
  { id: 'conference', label: 'Conference' },
  { id: 'medical', label: 'Medical' },
  { id: 'employment', label: 'Employment' },
  { id: 'study', label: 'Study' },
  { id: 'family', label: 'Visiting family' },
  { id: 'other', label: 'Other' },
];

/** Form C's fields, in the order the FRRO form asks for them. */
export const FORM_C_FIELDS = [
  'date_of_birth',
  'passport_number',
  'passport_issue_place',
  'passport_issue_date',
  'passport_expiry',
  'visa_number',
  'visa_type',
  'visa_issue_place',
  'visa_issue_date',
  'visa_expiry',
  'arrived_in_india',
  'arrived_from',
  'next_destination',
  'purpose',
  'address_abroad',
];

/** What the FRRO site will not take the form without. */
export const FORM_C_REQUIRED = ['date_of_birth', 'passport_number', 'passport_expiry', 'visa_number', 'visa_expiry', 'arrived_in_india', 'arrived_from', 'purpose', 'address_abroad'];

/** Where Form C is filed. */
export const FRRO_FORM_C_URL = 'https://indianfrro.gov.in/frro/FormC';
