import type { AcademicSession, Allocation, AvailabilityBed, Bed, Booking, Resident, Room, RoomRate } from "../../types/api";

export function residentName(resident?: Resident) {
  return resident ? `${resident.first_name} ${resident.last_name}` : "Resident unavailable";
}

export function leaseTermLabel(kind?: string | null) {
  if (kind === "academic_calendar") return "Academic Calendar";
  if (kind === "calendar_year") return "Calendar Year";
  if (kind === "short_term") return "Short-Term";
  return null;
}

/** Confirmed booking with no overlapping active occupancy for the same resident. */
export function bookingEligible(booking: Booking, allocations: Allocation[]) {
  if (booking.status !== "confirmed") return false;
  return !allocations.some((allocation) => {
    if (allocation.resident_id !== booking.resident_id || allocation.status !== "active") return false;
    // Active open-ended or overlapping the agreement window blocks a new create.
    return true;
  });
}

export function rateCompatible(booking: Booking, bed: AvailabilityBed) {
  // Agreement-aware availability already scopes to the approved room; amount is informational.
  if (booking.priced_room_id != null && bed.room_id === booking.priced_room_id) return true;
  return Number(booking.total_amount_minor) === Number(bed.amount_minor) && booking.currency === bed.currency;
}

export function placementLabel(bedId: number, rooms: Room[], bedsByRoom: Map<number, Bed[]>) {
  for (const room of rooms) {
    const bed = bedsByRoom.get(room.id)?.find((item) => item.id === bedId);
    if (bed) return { room, bed, label: `${room.room_code} / ${bed.bed_code}` };
  }
  return { room: undefined, bed: undefined, label: `Bed #${bedId}` };
}

export function sessionName(sessionId: number | null | undefined, sessions: AcademicSession[]) {
  if (sessionId == null) return "Not applicable";
  return sessions.find((session) => session.id === sessionId)?.name ?? `Session #${sessionId}`;
}

export function activeRateFor(roomId: number, sessionId: number, rates: RoomRate[]) {
  return rates.find((rate) => rate.room_id === roomId && rate.academic_session_id === sessionId && rate.status === "active");
}

export function agreementPeriodLabel(booking?: Booking | null) {
  if (!booking) return "Not available";
  const start = booking.starts_on ? String(booking.starts_on).slice(0, 10) : null;
  const end = booking.ends_on ? String(booking.ends_on).slice(0, 10) : null;
  if (start && end) return `${start} → ${end}`;
  if (start) return `${start} → open`;
  return "Not set";
}
