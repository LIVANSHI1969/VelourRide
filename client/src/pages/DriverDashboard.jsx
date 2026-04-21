import { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { io } from "socket.io-client";
import api from "../services/api";

export default function DriverDashboard() {
  const { user, logout } = useAuth();
  const [isOnline, setIsOnline] = useState(false);
  const [rideRequest, setRideRequest] = useState(null);
  const [activeRide, setActiveRide] = useState(null);
  const [socket, setSocket] = useState(null);
  const [earnings, setEarnings] = useState({ total: 0, recentRides: [] });
  const [loadingEarnings, setLoadingEarnings] = useState(true);

  useEffect(() => {
    const fetchEarnings = async () => {
      try {
        const { data } = await api.get('/drivers/earnings');
        setEarnings(data);
      } catch {
        // ignore
      } finally {
        setLoadingEarnings(false);
      }
    };
    fetchEarnings();
  }, []);

  useEffect(() => {
    const s = io(import.meta.env.VITE_SOCKET_URL || "http://localhost:5000");
    setSocket(s);
    return () => s.disconnect();
  }, []);

  const toggleOnline = async () => {
    try {
      const { data } = await api.put("/drivers/toggle");
      setIsOnline(data.isOnline);
      if (data.isOnline) {
        socket?.emit("driverOnline", user.id);
      } else {
        socket?.emit("driverOffline", user.id);
        setRideRequest(null);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    if (!socket) return;
    socket.on("newRideRequest", (ride) => {
      if (isOnline) setRideRequest(ride);
    });
    return () => socket.off("newRideRequest");
  }, [socket, isOnline]);

  const acceptRide = async () => {
    try {
      await api.put(`/rides/${rideRequest.rideId}/status`, { status: "accepted" });
      socket?.emit("acceptRide", { rideId: rideRequest.rideId, driverId: user.id });
      setActiveRide(rideRequest);
      setRideRequest(null);
    } catch (err) {
      console.error(err);
    }
  };

  const rejectRide = () => setRideRequest(null);

  const updateStatus = async (status) => {
    try {
      await api.put(`/rides/${activeRide.rideId}/status`, { status });
      if (status === "completed") setActiveRide(null);
      else setActiveRide({ ...activeRide, status });
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <div className="border-b border-[#1a1a1a] px-6 py-4 flex justify-between items-center">
        <div>
          <h1 className="text-lg tracking-[0.2em] font-light">VELOUR</h1>
          <p className="text-xs text-gray-600 tracking-widest">DRIVER</p>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-400">{user?.name?.split(" ")[0]}</span>
          <button onClick={logout} className="text-xs text-gray-600 hover:text-white transition-colors">
            Sign out
          </button>
        </div>
      </div>

      <div className="max-w-md mx-auto px-6 py-8 space-y-6">
        {/* Earnings */}
        <div className="bg-gradient-to-r from-green-500/10 to-blue-500/10 border border-green-500/30 rounded-2xl p-6 text-center">
          <p className="text-sm text-gray-400 tracking-widest mb-1">THIS WEEK</p>
          <p className="text-3xl font-bold text-white">₹{earnings.total}</p>
          <p className="text-xs text-gray-500 mt-1">{earnings.recentRides.length} rides</p>
        </div>

        {/* Online toggle */}
        <div className="bg-[#111] border border-[#222] rounded-2xl p-6 flex justify-between items-center">
          <div>
            <p className="text-sm font-medium text-white">
              {isOnline ? "You are online" : "You are offline"}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              {isOnline ? "Accepting ride requests" : "Toggle to start accepting rides"}
            </p>
          </div>
          <button
            onClick={toggleOnline}
            className={`w-14 h-7 rounded-full transition-colors relative ${
              isOnline ? "bg-white" : "bg-[#333]"
            }`}
          >
            <span
              className={`absolute top-1 w-5 h-5 rounded-full transition-all ${
                isOnline ? "right-1 bg-black" : "left-1 bg-[#666]"
              }`}
            />
          </button>
        </div>

        {/* Incoming ride request */}
        {rideRequest && (
          <div className="bg-[#111] border border-white rounded-2xl p-5 space-y-4">
            <p className="text-xs text-gray-400 tracking-widest">NEW RIDE REQUEST</p>
            <div className="space-y-2">
              <div className="flex gap-2 text-sm">
                <span className="text-gray-500 w-20">Pickup</span>
                <span className="text-white">{rideRequest.pickup?.address}</span>
              </div>
              <div className="flex gap-2 text-sm">
                <span className="text-gray-500 w-20">Drop-off</span>
                <span className="text-white">{rideRequest.destination?.address}</span>
              </div>
              <div className="flex gap-2 text-sm">
                <span className="text-gray-500 w-20">Fare</span>
              <span className="text-white font-medium">₹{rideRequest.fare?.total}</span>
              </div>
              <div className="flex gap-2 text-sm">
                <span className="text-gray-500 w-20">Type</span>
                <span className="text-white capitalize">{rideRequest.rideType}</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                onClick={rejectRide}
                className="py-3 rounded-xl border border-[#333] text-gray-400 text-sm hover:border-[#555] transition-colors"
              >
                Decline
              </button>
              <button
                onClick={acceptRide}
                className="py-3 rounded-xl bg-white text-black text-sm font-medium hover:bg-gray-100 transition-colors"
              >
                Accept
              </button>
            </div>
          </div>
        )}

        {/* Active ride */}
        {activeRide && (
          <div className="bg-[#111] border border-[#222] rounded-2xl p-5 space-y-4">
            <p className="text-xs text-gray-400 tracking-widest">ACTIVE RIDE</p>
            <div className="space-y-2">
              <div className="flex gap-2 text-sm">
                <span className="text-gray-500 w-20">Pickup</span>
                <span className="text-white">{activeRide.pickup?.address}</span>
              </div>
              <div className="flex gap-2 text-sm">
                <span className="text-gray-500 w-20">Drop-off</span>
                <span className="text-white">{activeRide.destination?.address}</span>
              </div>
              <div className="flex gap-2 text-sm">
                <span className="text-gray-500 w-20">Status</span>
                <span className="text-white capitalize">{activeRide.status || "accepted"}</span>
              </div>
            </div>
            <div className="space-y-2 pt-2">
              {(!activeRide.status || activeRide.status === "accepted") && (
                <button
                  onClick={() => updateStatus("arriving")}
                  className="w-full py-3 rounded-xl border border-[#333] text-white text-sm hover:border-[#555] transition-colors"
                >
                  I'm arriving
                </button>
              )}
              {activeRide.status === "arriving" && (
                <button
                  onClick={() => updateStatus("inProgress")}
                  className="w-full py-3 rounded-xl border border-[#333] text-white text-sm hover:border-[#555] transition-colors"
                >
                  Start ride
                </button>
              )}
              {activeRide.status === "inProgress" && (
                <button
                  onClick={() => updateStatus("completed")}
                  className="w-full py-3 rounded-xl bg-white text-black text-sm font-medium hover:bg-gray-100 transition-colors"
                >
                  Complete ride
                </button>
              )}
            </div>
          </div>
        )}

        {/* Empty state */}
        {isOnline && !rideRequest && !activeRide && (
          <div className="text-center py-16">
            <div className="text-4xl mb-4">🚗</div>
            <p className="text-gray-400 text-sm">Waiting for ride requests...</p>
          </div>
        )}

        {!isOnline && (
          <div className="text-center py-16">
            <p className="text-gray-600 text-sm">Go online to start accepting rides</p>
          </div>
        )}
      </div>
    </div>
  );
}