import { FormEvent, useState } from "react";
import { ConfirmDialog } from "../../components/common/ConfirmDialog";

export function RoomFormDialog({ open, saving, error, onClose, onCreate }: { open: boolean; saving: boolean; error: string | null; onClose: () => void; onCreate: (input: { roomCode: string; roomName?: string | null; floor?: string | null; capacity: number; genderPolicy: string; status: string }) => void }) {
  const [roomCode, setRoomCode] = useState("");
  const [roomName, setRoomName] = useState("");
  const [floor, setFloor] = useState("");
  const [capacity, setCapacity] = useState("1");
  const [genderPolicy, setGenderPolicy] = useState("any");
  const [status, setStatus] = useState("available");
  const [localError, setLocalError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    setLocalError(null);
    const parsedCapacity = Number.parseInt(capacity, 10);
    if (!roomCode.trim() || !Number.isInteger(parsedCapacity) || parsedCapacity < 1) {
      setLocalError("Room code and a positive configured capacity are required.");
      return;
    }
    onCreate({ roomCode: roomCode.trim(), roomName: roomName.trim() || null, floor: floor.trim() || null, capacity: parsedCapacity, genderPolicy, status });
  }

  return (
    <ConfirmDialog open={open} title="Create Room" description="Configured capacity sets a maximum. Bed records are created separately." onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium">Room code<input aria-label="Room code" value={roomCode} onChange={(event) => setRoomCode(event.target.value)} className="mt-1 w-full rounded-md border border-border px-3 py-2" /></label>
          <label className="text-sm font-medium">Display name<input aria-label="Display name" value={roomName} onChange={(event) => setRoomName(event.target.value)} className="mt-1 w-full rounded-md border border-border px-3 py-2" /></label>
          <label className="text-sm font-medium">Floor<input aria-label="Floor" value={floor} onChange={(event) => setFloor(event.target.value)} className="mt-1 w-full rounded-md border border-border px-3 py-2" /></label>
          <label className="text-sm font-medium">Configured capacity<input aria-label="Configured capacity" value={capacity} onChange={(event) => setCapacity(event.target.value)} className="mt-1 w-full rounded-md border border-border px-3 py-2" /></label>
          <label className="text-sm font-medium">Gender policy<select aria-label="Gender policy" value={genderPolicy} onChange={(event) => setGenderPolicy(event.target.value)} className="mt-1 w-full rounded-md border border-border px-3 py-2"><option value="any">Any</option><option value="female">Female</option><option value="male">Male</option></select></label>
          <label className="text-sm font-medium">Status<select aria-label="Room status" value={status} onChange={(event) => setStatus(event.target.value)} className="mt-1 w-full rounded-md border border-border px-3 py-2"><option value="available">Available</option><option value="maintenance">Maintenance</option><option value="inactive">Inactive</option><option value="archived">Archived</option></select></label>
        </div>
        {localError || error ? <p role="alert" className="text-sm font-medium text-danger">{localError || error}</p> : null}
        <div className="flex justify-end gap-2"><button type="button" onClick={onClose} disabled={saving} className="rounded-md border border-border px-3 py-2 text-sm font-semibold">Cancel</button><button type="submit" disabled={saving} className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Creating..." : "Create Room"}</button></div>
      </form>
    </ConfirmDialog>
  );
}
