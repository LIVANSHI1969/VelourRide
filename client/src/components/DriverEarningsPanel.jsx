export default function DriverEarningsPanel({ earnings, ratings }) {
  return (
    <div className="bg-gradient-to-r from-green-500/10 to-blue-500/10 border border-green-500/30 rounded-2xl p-6">
      <p className="text-sm text-gray-400 tracking-widest mb-1">EARNINGS DASHBOARD</p>
      <p className="text-2xl font-bold text-white">Rs {earnings?.total || 0}</p>
      <div className="grid grid-cols-3 gap-3 mt-4 text-center">
        <div className="bg-[#181818] rounded-xl p-2">
          <p className="text-[10px] text-gray-500">Today</p>
          <p className="text-sm font-semibold">Rs {earnings?.today || 0}</p>
        </div>
        <div className="bg-[#181818] rounded-xl p-2">
          <p className="text-[10px] text-gray-500">Completed</p>
          <p className="text-sm font-semibold">{earnings?.ridesCount || 0}</p>
        </div>
        <div className="bg-[#181818] rounded-xl p-2">
          <p className="text-[10px] text-gray-500">Ratings</p>
          <p className="text-sm font-semibold">
            {ratings?.average ?? "-"} ({ratings?.count || 0})
          </p>
        </div>
      </div>
    </div>
  );
}
