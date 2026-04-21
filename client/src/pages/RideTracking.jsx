import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { io } from "socket.io-client";
import api from "../services/api";

const STATUS_LABELS = {
  searching:  "Finding your driver...",
  accepted:   "Driver accepted — heading to you",
  arriving:   "Driver is arriving",
  inProgress: "Ride in progress",
  completed:  "Ride completed",
  cancelled:  "Ride cancelled",
};

export default function RideTracking() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [ride, setRide] = useState(null);
  const [status, setStatus] = useState("searching");

  useEffect(() => {
    const fetchRide = async () => {
      try {
        const { data } = await api.get(`/rides/${id}`);
        setRide(data.ride);
        setStatus(data.ride.status);
      } catch (err) {
        console.error(err);
      }
    };
    fetchRide();

    const socket = io(import.meta.env.VITE_SOCKET_URL || "http://localhost:5000");
    socket.emit("joinRide", id);

    socket.on("rideStatusUpdate", ({ status }) => {
      setStatus(status);
      if (status === "completed") {
        setTimeout(() => navigate("/ride"), 3000);
      }
    });

    socket.on("rideAccepted", () => setStatus("accepted"));

    return () => socket.disconnect();
  }, [id]);

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      {/* Header */}
      <div className="border-b border-[#1a1a1a] px-6 py-4 flex justify-between items-center">
        <div>
          <h1 className="text-lg tracking-[0.2em] font-light">VELOUR</h1>
          <p className="text-xs text-gray-600 tracking-widest">RIDE</p>
        </div>
        <div className="flex gap-2">
          {status !== "completed" && status !== "cancelled" && status !== "inProgress" && (
            <button
              onClick={async () => {
                if (confirm("Cancel this ride?")) {
                  try {
                    await api.delete(`/rides/${id}`);
                    navigate("/ride");
                  } catch (err) {
                    alert("Cancel failed");
                  }
                }
              }}
              className="text-xs text-red-400 hover:text-red-300 transition-colors flex-1 text-center py-2 border border-red-500/30 rounded-lg"
            >
              Cancel ride
            </button>
          )}
          <button
            onClick={() => navigate("/ride")}
            className="text-xs text-gray-600 hover:text-white transition-colors flex-1 text-center py-2 border border-gray-600 rounded-lg"
          >
            {status === "completed" ? "Home" : "Back"}
          </button>
        </div>
      </div>

      {/* Map placeholder */}
      <div className="flex-1 bg-[#0a0a0a] relative flex items-center justify-center">
        <div className="text-center">
          <div className="text-6xl mb-4">🗺️</div>
          <p className="text-gray-600 text-sm">Live map coming in Phase 4</p>
        </div>

        {/* Status pill */}
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-[#111] border border-[#2a2a2a] rounded-full px-5 py-2.5 flex items-center gap-2">
          <span className="w-2 h-2 bg-white rounded-full animate-pulse"></span>
          <span className="text-sm text-gray-300 whitespace-nowrap">
            {STATUS_LABELS[status] || status}
          </span>
        </div>
      </div>

      {/* Ride details */}
      {ride && (
        <div className="bg-[#111] border-t border-[#222] px-6 py-5 space-y-4">
          {ride.driver && (
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-[#222] flex items-center justify-center text-lg">👤</div>
              <div className="flex-1">
                <p className="text-sm font-medium">{ride.driver.name}</p>
                <p className="text-xs text-gray-500">
                  ★ {ride.driver.rating} · {ride.driver.vehicle?.model} · {ride.driver.vehicle?.plate}
                </p>
              </div>
              <p className="text-lg font-medium">₹{ride.fare?.total}</p>
            </div>
          )}

          <div className="space-y-2">
            <div className="flex gap-2 text-sm">
              <span className="text-gray-500 w-24">Pickup</span>
              <span className="text-white">{ride.pickup?.address}</span>
            </div>
            <div className="flex gap-2 text-sm">
              <span className="text-gray-500 w-24">Drop-off</span>
              <span className="text-white">{ride.destination?.address}</span>
            </div>
          </div>

          {status === "completed" && (
            <div className="bg-[#1a1a1a] rounded-xl p-4 text-center">
              <p className="text-white font-medium">Ride complete!</p>
              <p className="text-gray-500 text-sm mt-1">Returning to home...</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}