import VehicleIcon from "./VehicleIcon";

export default function RideCard({ ride, onAccept, onReject, busy = false }) {
  return (
    <div className="border border-[#2a2a2a] rounded-xl p-3 space-y-2">
      <div className="flex justify-between items-center">
        <p className="text-sm text-white font-medium">
          {ride.rider?.name || ride.riderName || "Rider"}
        </p>
        <span className="text-[10px] text-amber-300 uppercase">
          {(ride.status || "requested").replace("searching", "requested")}
        </span>
      </div>

      <p className="text-xs text-gray-400 truncate">Pickup: {ride.pickup?.address || ride.pickupLocation}</p>
      <p className="text-xs text-gray-500 truncate">Drop: {ride.destination?.address || ride.destinationLocation}</p>

      <div className="flex items-center justify-between text-xs">
        <span className="text-white inline-flex items-center gap-1">
          <VehicleIcon vehicleType={ride.rideType || "standard"} size={12} color="#9CA3AF" />
          {(ride.rideType || "standard").toUpperCase()}
        </span>
        <span className="text-white font-medium">Rs {ride.fare?.total || 0}</span>
      </div>

      <div className="grid grid-cols-2 gap-2 pt-1">
        <button
          onClick={() => onReject(ride._id)}
          disabled={busy}
          className="py-2 rounded-lg border border-[#333] text-gray-400 text-xs hover:border-[#555] disabled:opacity-40"
        >
          Reject
        </button>
        <button
          onClick={() => onAccept(ride._id)}
          disabled={busy}
          className="py-2 rounded-lg bg-white text-black text-xs font-medium hover:bg-gray-100 disabled:opacity-40"
        >
          Accept
        </button>
      </div>
    </div>
  );
}
