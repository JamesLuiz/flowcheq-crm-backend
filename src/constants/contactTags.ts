/** Predefined tags for manual assignment in the CRM UI. Keep in sync with src/constants/contactTags.ts */
export const CONTACT_TAG_OPTIONS = [
  'Imported',
  'Lead',
  'Prospect',
  'Customer',
  'VIP',
  'Follow-up',
  'Interested',
  'Not Interested',
  'No Answer',
  'Marketing',
] as const;

export type ContactTagOption = (typeof CONTACT_TAG_OPTIONS)[number];
