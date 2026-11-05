/**
 * Why a booking was cancelled.
 *
 * Asked at the desk every time a booking is cancelled, and kept on the
 * booking with the time. 'channel' is set by the system when an OTA cancels
 * a booking; the desk never picks it. 'mistake' is set by Delete booking.
 */

export const CANCEL_REASONS = [
  { id: 'guest_changed_plans', label: 'Guest changed plans' },
  { id: 'found_cheaper', label: 'Guest found a cheaper place' },
  { id: 'payment_not_received', label: 'Payment not received' },
  { id: 'hotel_could_not_host', label: 'Hotel could not host' },
  { id: 'duplicate', label: 'Duplicate booking' },
  { id: 'other', label: 'Other' },
];

// Reasons the system sets itself.
const SYSTEM_REASONS = [
  { id: 'channel', label: 'Cancelled on the channel' },
  { id: 'mistake', label: 'Entered by mistake' },
];

const ALL = [...CANCEL_REASONS, ...SYSTEM_REASONS];

export function isCancelReason(id) {
  return ALL.some((r) => r.id === id);
}

export function cancelReasonLabel(id) {
  return ALL.find((r) => r.id === id)?.label || '';
}

/**
 * Ask the desk why. Returns the reason id, or null if they backed out.
 * An inquiry also warns that it cannot be put back as an inquiry.
 */
export function askCancelReason(dialog, r) {
  const inquiry = r.status === 'inquiry';
  return dialog.choose({
    title: `Cancel ${r.guest_name}'s ${inquiry ? 'inquiry' : 'booking'} ${r.reference}?`,
    message: inquiry ? 'A cancelled inquiry cannot be put back as an inquiry.' : undefined,
    label: 'Why is it cancelled?',
    options: CANCEL_REASONS.map((x) => ({ value: x.id, label: x.label })),
    confirmLabel: inquiry ? 'Cancel inquiry' : 'Cancel booking',
    cancelLabel: 'Keep it',
  });
}
