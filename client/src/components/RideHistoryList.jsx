export default function RideHistoryList({ rides = [] }) {
  return (
    <div className="bg-[#111] border border-[#222] rounded-2xl p-4">
      <p className="text-xs text-gray-400 tracking-widest mb-2">RIDE HISTORY</p>
      {rides.length === 0 ? (
        <p className="text-xs text-gray-600">No past rides</p>
      ) : (
        rides.slice(0, 6).map((ride) => (
          <div key={ride._id} className="py-2 border-b border-[#1a1a1a] last:border-0">
            <div className="flex justify-between items-center">
              <p className="text-xs text-white">{ride.rider?.name || ride.riderName || "Rider"}</p>
              <p className="text-[10px] text-gray-500 uppercase">{ride.status}</p>
            </div>
            <p className="text-[11px] text-gray-500 truncate">
              {ride.pickup?.address || ride.pickupLocation} to {ride.destination?.address || ride.destinationLocation}
            </p>
            <div className="flex justify-between text-[11px] mt-1">
              <span className="text-gray-500">{new Date(ride.createdAt).toLocaleString()}</span>
              <span className="text-white">Rs {ride.fare?.total || 0}</span>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
