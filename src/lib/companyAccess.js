import { BOOKING_VIEW_PAGES } from "@/lib/pmsGuard";

/**
 * Who may reach companies and agents. Choosing one on a booking is desk
 * work, so any booking page may list them; adding, changing or deleting one
 * -- and its contracted rates -- is the Companies & agents page's own work.
 */
export const COMPANY_LOOKUP_PAGES = ["companies", ...BOOKING_VIEW_PAGES];
export const COMPANY_EDIT_PAGES = ["companies"];
export const COMPANIES_NOT_READY = "Companies and agents are not switched on for this property yet.";
