import type { AcademicSession, Allocation, AvailabilityBed, Bed, Booking, Resident, Room, RoomRate } from "../../types/api";

export function residentName(resident?: Resident) {
  return resident ? `${resident.first_name} ${resident.last_name}` : "Resident unavailable";
}

export function bookingEligible(booking: Booking, allocations: Allocation[]) {
  return booking.status === "confirmed" && !allocations.some((allocation) => allocation.resident_id === booking.resident_id && allocation.academic_session_id === booking.academic_session_id && allocation.status === "active");
}

export function rateCompatible(booking: Booking, bed: AvailabilityBed) {
  return Number(booking.total_amount_minor) === Number(bed.amount_minor) && booking.currency === bed.currency;
}

export function placementLabel(bedId: number, rooms: Room[], bedsByRoom: Map<number, Bed[]>) {
  for (const room of rooms) {
    const bed = bedsByRoom.get(room.id)?.find((item) => item.id === bedId);
    if (bed) return { room, bed, label: `${room.room_code} / ${bed.bed_code}` };
  }
  return { room: undefined, bed: undefined, label: `Bed #${bedId}` };
}

export function sessionName(sessionId: number, sessions: AcademicSession[]) {
  return sessions.find((session) => session.id === sessionId)?.name ?? `Session #${sessionId}`;
}

export function activeRateFor(roomId: number, sessionId: number, rates: RoomRate[]) {
  return rates.find((rate) => rate.room_id === roomId && rate.academic_session_id === sessionId && rate.status === "active");
}
