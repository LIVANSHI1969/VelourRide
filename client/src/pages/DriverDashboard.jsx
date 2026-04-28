import { useState, useEffect, useRef } from "react";
import { useAuth } from "../context/AuthContext";
import { io } from "socket.io-client";
import api from "../services/api";
import VehicleIcon from "../components/VehicleIcon";
import RideCard from "../components/RideCard";
import DriverEarningsPanel from "../components/DriverEarningsPanel";
import RideHistoryList from "../components/RideHistoryList";
import {
  acceptRideRequest,
  fetchDriverDashboard,
  fetchNavigationRoute,
  fetchRequestedRides as fetchRequestedRidesApi,
  rejectRideRequest as rejectRideRequestApi,
  toggleDriverOnline,
  updateDriverLocation,
  updateRideStatus as updateRideStatusApi,
} from "../services/driverApi";

export default function DriverDashboard() {
  const { user, logout } = useAuth();
  const [isOnline, setIsOnline]       = useState(false);
  const [rideRequest, setRideRequest] = useState(null);
  const [activeRide, setActiveRide]   = useState(null);
  const [socket, setSocket]           = useState(null);
  const [earnings, setEarnings]       = useState({ total: 0, recentRides: [] });
  const [loadingEarnings, setLoadingEarnings] = useState(true);
  const [locationStatus, setLocationStatus]   = useState("");
  const [earningsSummary, setEarningsSummary] = useState(null);
  const [wallet, setWallet] = useState({ balance: 0, transactions: [] });
  const [notifications, setNotifications] = useState([]);
  const [verification, setVerification] = useState({ status: "notSubmitted", documents: [] });
  const [scheduledRides, setScheduledRides] = useState([]);
  const [heatmapZones, setHeatmapZones] = useState([]);
  const [history, setHistory] = useState([]);
  const [historyFilters, setHistoryFilters] = useState({ from: "", to: "", minEarnings: "", minDistance: "" });
  const [requestTimer, setRequestTimer] = useState(0);
  const [requestedRides, setRequestedRides] = useState([]);
  const [loadingRequestedRides, setLoadingRequestedRides] = useState(false);
  const [requestActionLoading, setRequestActionLoading] = useState(false);
  const [navLoading, setNavLoading] = useState(false);
  const watchRef = useRef(null);
  const activeRideId = activeRide?.rideId || activeRide?._id;

  // Chat
  const [chatOpen,  setChatOpen]  = useState(false);
  const [messages,  setMessages]  = useState([]);
  const [input,     setInput]     = useState("");
  const [unread,    setUnread]    = useState(0);
  const chatEndRef  = useRef(null);
  const socketRef   = useRef(null);

  const loadDriverDashboard = async () => {
    try {
      const { data } = await fetchDriverDashboard();
      setIsOnline(Boolean(data.driver?.isOnline));
      setEarnings({
        total: data.earnings?.total || 0,
        recentRides: data.history || [],
      });
      setHistory(data.history || []);
      setActiveRide((prev) => prev || (data.activeRide ? { ...data.activeRide, rideId: data.activeRide._id } : null));
      if (data.ratings) {
        setEarningsSummary((prev) => ({
          ...prev,
          ratings: data.ratings,
          today: data.earnings?.today || 0,
          total: data.earnings?.total || 0,
          ridesCount: data.earnings?.ridesCount || 0,
        }));
      }
    } catch (err) {
      console.error("Failed to load dashboard", err.message);
    }
  };

  useEffect(() => {
    const fetchEarnings = async () => {
      try {
        const { data } = await api.get("/drivers/earnings");
        setEarnings(data);
      } catch { /* ignore */ }
      finally { setLoadingEarnings(false); }
    };
    fetchEarnings();
  }, []);

  useEffect(() => {
    loadDriverDashboard();
  }, []);

  useEffect(() => {
    const bootstrapDriverInsights = async () => {
      try {
        const [
          earningsSummaryRes,
          walletRes,
          notifRes,
          verifyRes,
          scheduledRes,
          heatmapRes,
          historyRes,
        ] = await Promise.all([
          api.get("/drivers/earnings-summary"),
          api.get("/drivers/wallet"),
          api.get("/drivers/notifications"),
          api.get("/drivers/verification"),
          api.get("/rides/scheduled/driver"),
          api.get("/drivers/heatmap"),
          api.get("/rides/history"),
        ]);
        setEarningsSummary(earningsSummaryRes.data);
        setWallet(walletRes.data);
        setNotifications(notifRes.data.notifications || []);
        setVerification(verifyRes.data.verification || { status: "notSubmitted", documents: [] });
        setScheduledRides(scheduledRes.data.rides || []);
        setHeatmapZones(heatmapRes.data.zones || []);
        setHistory(historyRes.data.rides || []);
      } catch (err) {
        console.error("Failed to load driver insights", err.message);
      }
    };
    bootstrapDriverInsights();
  }, []);

  const fetchRequestedRides = async () => {
    setLoadingRequestedRides(true);
    try {
      const { data } = await fetchRequestedRidesApi();
      setRequestedRides(data.rides || []);
    } catch (err) {
      console.error("Failed to fetch requested rides", err.message);
    } finally {
      setLoadingRequestedRides(false);
    }
  };

  // Keep chatOpenRef in sync — lets socket listener read latest value without stale closure
  const chatOpenRef = useRef(false);
  useEffect(() => { chatOpenRef.current = chatOpen; }, [chatOpen]);

  useEffect(() => {
    const s = io(import.meta.env.VITE_SOCKET_URL || "http://localhost:5000");
    setSocket(s);
    socketRef.current = s;
    if (user?.id) s.emit("joinUser", user.id);

    s.on("chatMessage", (msg) => {
      // Only add if it came from the OTHER side (rider)
      // Driver's own messages are added locally in sendMessage()
      if (msg.senderRole !== "driver") {
        setMessages(prev => [...prev, msg]);
        if (!chatOpenRef.current) setUnread(u => u + 1);
      }
    });

    s.on("notification", (notif) => {
      setNotifications((prev) => [{ ...notif, _id: `${Date.now()}-${Math.random()}`, read: false }, ...prev]);
    });

    s.on("rideStatusUpdate", ({ ride }) => {
      if (!ride) return;
      setActiveRide((prev) => {
        if (!prev) return prev;
        if (prev.rideId !== ride._id && prev._id !== ride._id) return prev;
        return { ...prev, ...ride, rideId: ride._id };
      });
    });

    s.on("paymentUpdated", ({ paymentStatus, rideId }) => {
      setActiveRide((prev) =>
        prev && (prev.rideId === rideId || prev._id === rideId)
          ? { ...prev, payment: { ...(prev.payment || {}), status: paymentStatus } }
          : prev
      );
    });

    return () => s.disconnect();
  }, [user?.id]);

  // ── Live GPS tracking — runs while driver is online ───────────────────────
  useEffect(() => {
    if (!isOnline) {
      if (watchRef.current != null) {
        navigator.geolocation.clearWatch(watchRef.current);
        watchRef.current = null;
        setLocationStatus("");
      }
      return;
    }

    if (!navigator.geolocation) {
      setLocationStatus("⚠ GPS unavailable");
      return;
    }

    setLocationStatus("📍 Getting location...");

    watchRef.current = navigator.geolocation.watchPosition(
      async ({ coords }) => {
        const { latitude: lat, longitude: lng } = coords;
        setLocationStatus(`📍 ${lat.toFixed(5)}, ${lng.toFixed(5)}`);
        try {
          await updateDriverLocation(lat, lng);
          if (activeRideId && socketRef.current) {
            socketRef.current.emit("driverLocation", { rideId: activeRideId, lat, lng });
          }
        } catch (err) {
          console.error("Location push failed:", err.message);
        }
      },
      (err) => {
        console.error("Geolocation error:", err);
        setLocationStatus("⚠ Location error — check permissions");
      },
      { enableHighAccuracy: true, maximumAge: 8000, timeout: 10000 }
    );

    return () => {
      if (watchRef.current != null) {
        navigator.geolocation.clearWatch(watchRef.current);
        watchRef.current = null;
      }
    };
  }, [isOnline, activeRideId]);

  const toggleOnline = async () => {
    try {
      const { data } = await toggleDriverOnline();
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
      if (!isOnline) return;
      if (ride.assignedDriverId && ride.assignedDriverId !== user?.id) return;
      setRideRequest(ride);
      setRequestTimer(30);
      fetchRequestedRides();
    });
    return () => socket.off("newRideRequest");
  }, [socket, isOnline, user?.id]);

  useEffect(() => {
    if (!isOnline) {
      setRequestedRides([]);
      return;
    }
    fetchRequestedRides();
  }, [isOnline]);

  useEffect(() => {
    if (!isOnline) return;
    const iv = setInterval(() => {
      fetchRequestedRides();
    }, 5000);
    return () => clearInterval(iv);
  }, [isOnline]);

  useEffect(() => {
    if (!rideRequest || requestTimer <= 0) return;
    const iv = setInterval(() => {
      setRequestTimer((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(iv);
  }, [rideRequest, requestTimer]);

  useEffect(() => {
    if (!rideRequest) return;
    if (requestTimer > 0) return;
    setRideRequest(null);
  }, [requestTimer, rideRequest]);

  const acceptRide = async () => {
    try {
      if (!rideRequest?.rideId) return;
      const { data } = await api.put(`/rides/${rideRequest.rideId}/accept`);
      const acceptedRide = data?.ride || { ...rideRequest, status: "accepted", _id: rideRequest.rideId };
      socketRef.current?.emit("acceptRide", { rideId: rideRequest.rideId, driverId: user.id });
      socketRef.current?.emit("joinRide", rideRequest.rideId);
      setMessages([]);
      setActiveRide({ ...acceptedRide, rideId: acceptedRide._id || rideRequest.rideId });
      setRideRequest(null);
      setRequestedRides((prev) => prev.filter((r) => r._id !== rideRequest.rideId));
      setChatOpen(true); // auto-open chat when ride is accepted
      fetchRequestedRides();

      // Auto-send greeting message
      setTimeout(() => {
        const autoMsg = `Hi! I'm ${user?.name || "your driver"} and I've accepted your ride. On my way! 🚗`;
        setMessages(prev => [...prev, {
          message:    autoMsg,
          senderName: user?.name || "Driver",
          senderRole: "driver",
          timestamp:  Date.now(),
        }]);
        socketRef.current?.emit("chatMessage", {
          rideId:     rideRequest.rideId,
          message:    autoMsg,
          senderName: user?.name || "Driver",
          senderRole: "driver",
        });
      }, 800);
    } catch (err) {
      console.error("Accept ride failed", err?.response?.data || err.message);
      alert(err?.response?.data?.message || "Failed to accept ride");
    }
  };

  const rejectRide = async () => {
    try {
      if (rideRequest?.rideId) {
        await api.put(`/rides/${rideRequest.rideId}/reject`);
      }
    } catch (err) {
      console.error("Reject failed", err.message);
    } finally {
      setRideRequest(null);
      fetchRequestedRides();
    }
  };

  const acceptRequestedRide = async (rideId) => {
    setRequestActionLoading(true);
    try {
      const { data } = await acceptRideRequest(rideId);
      socketRef.current?.emit("acceptRide", { rideId, driverId: user.id });
      socketRef.current?.emit("joinRide", rideId);
      const accepted = data?.ride || requestedRides.find((r) => r._id === rideId);
      if (accepted) {
        setActiveRide({ ...accepted, rideId: accepted._id || rideId, status: accepted.status || "accepted" });
        setMessages([]);
        setChatOpen(true);
      }
      setRequestedRides((prev) => prev.filter((r) => r._id !== rideId));
      setRideRequest(null);
      fetchRequestedRides();
    } catch (err) {
      console.error("Accept requested ride failed", { rideId, error: err?.response?.data || err.message });
      alert(err?.response?.data?.message || "Failed to accept ride");
    } finally {
      setRequestActionLoading(false);
    }
  };

  const rejectRequestedRide = async (rideId) => {
    setRequestActionLoading(true);
    try {
      await rejectRideRequestApi(rideId);
      fetchRequestedRides();
    } catch (err) {
      alert(err?.response?.data?.message || "Failed to reject ride");
    } finally {
      setRequestActionLoading(false);
    }
  };

  // Works for both typed input (no arg) and quick-reply chips (text arg)
  const sendMessage = (text) => {
    const msg = (text ?? input).trim();
    const rideId = activeRideId;
    if (!msg || !rideId || !socketRef.current) return;

    // Add own message locally RIGHT NOW (right side)
    setMessages(prev => [...prev, {
      message:    msg,
      senderName: user?.name || "Driver",
      senderRole: "driver",
      timestamp:  Date.now(),
    }]);

    socketRef.current.emit("chatMessage", {
      rideId,
      message:    msg,
      senderName: user?.name || "Driver",
      senderRole: "driver",
      senderId: user?.id,
    });
    if (!text) setInput("");
  };

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior:"smooth" }); }, [messages, chatOpen]);
  useEffect(() => { if (chatOpen) setUnread(0); }, [chatOpen]);

  // Auto-messages sent when driver changes ride status
  const STATUS_AUTO_MSG = {
    arriving:   "I've arrived at your pickup! 🎯 Please come outside.",
    inProgress: "Ride started! Sit back and relax 🚀",
    completed:  "We've reached your destination. Thanks for riding with Velour! 😊",
  };

  const updateStatus = async (status) => {
    try {
      await updateRideStatusApi(activeRideId, status);
      if (status === "completed" && ["card", "wallet"].includes(activeRide?.payment?.method)) {
        await api.put(`/rides/${activeRideId}/payment`, {
          status: "paid",
          transactionId: `txn_${Date.now()}`,
        });
      }

      // Auto-send a message for this status change
      const autoMsg = STATUS_AUTO_MSG[status];
      if (autoMsg && socketRef.current) {
        setMessages(prev => [...prev, {
          message:    autoMsg,
          senderName: user?.name || "Driver",
          senderRole: "driver",
          timestamp:  Date.now(),
        }]);
        socketRef.current.emit("chatMessage", {
          rideId:     activeRideId,
          message:    autoMsg,
          senderName: user?.name || "Driver",
          senderRole: "driver",
        });
      }

      if (status === "completed") setActiveRide(null);
      else setActiveRide({ ...activeRide, status });
      loadDriverDashboard();
    } catch (err) { console.error(err); }
  };

  const navigateToPickup = async () => {
    if (!activeRide?.pickup?.coordinates) return;
    setNavLoading(true);
    try {
      const pickup = activeRide.pickup.coordinates;
      const current = activeRide?.driver?.location?.coordinates
        ? { lng: activeRide.driver.location.coordinates[0], lat: activeRide.driver.location.coordinates[1] }
        : null;
      if (current) {
        await fetchNavigationRoute(
          { lat: current.lat, lng: current.lng },
          { lat: pickup.lat, lng: pickup.lng }
        );
      }
      window.open(`https://www.google.com/maps/dir/?api=1&destination=${pickup.lat},${pickup.lng}`, "_blank");
    } catch (err) {
      console.error("Navigation failed", err.message);
    } finally {
      setNavLoading(false);
    }
  };

  const withdrawFromWallet = async () => {
    const amount = Number(prompt("Enter withdrawal amount"));
    if (!amount) return;
    try {
      const { data } = await api.post("/drivers/wallet/withdraw", { amount });
      setWallet((prev) => ({ ...prev, balance: data.balance }));
    } catch (err) {
      alert(err?.response?.data?.message || "Withdrawal failed");
    }
  };

  const triggerSOS = async () => {
    try {
      await api.post("/drivers/sos", {
        rideId: activeRide?.rideId || null,
        note: "Driver requested emergency assistance",
      });
      alert("SOS alert sent successfully");
    } catch (err) {
      alert("Failed to send SOS");
    }
  };

  const markAsRead = async (id) => {
    try {
      await api.put(`/drivers/notifications/${id}/read`);
      setNotifications((prev) => prev.map((n) => (n._id === id ? { ...n, read: true } : n)));
    } catch {
      // noop
    }
  };

  const submitVerification = async () => {
    const docType = prompt("Document type (license/aadhaar/passport)");
    const docNumber = prompt("Document number");
    if (!docType || !docNumber) return;
    try {
      await api.post("/drivers/verification", {
        documents: [{ type: docType, number: docNumber }],
      });
      setVerification((prev) => ({ ...prev, status: "pending", documents: [{ type: docType, number: docNumber }] }));
    } catch (err) {
      alert("Verification submission failed");
    }
  };

  const applyHistoryFilters = async () => {
    try {
      const params = Object.fromEntries(Object.entries(historyFilters).filter(([, v]) => v !== ""));
      const { data } = await api.get("/rides/history", { params });
      setHistory(data.rides || []);
    } catch {
      // noop
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
        <DriverEarningsPanel
          earnings={{
            total: earningsSummary?.total ?? earnings.total,
            today: earningsSummary?.today ?? earningsSummary?.daily?.total ?? 0,
            ridesCount: earningsSummary?.ridesCount ?? earnings.recentRides?.length ?? 0,
          }}
          ratings={earningsSummary?.ratings || { average: user?.rating ?? null, count: 0 }}
        />

        {/* Earnings breakdown */}
        {earningsSummary && (
          <div className="bg-[#111] border border-[#222] rounded-2xl p-4">
            <p className="text-xs text-gray-400 tracking-widest mb-3">EARNINGS BREAKDOWN</p>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-[#181818] rounded-xl p-2">
                <p className="text-[10px] text-gray-500">Today</p>
                <p className="text-sm font-semibold">₹{earningsSummary.daily?.total || 0}</p>
              </div>
              <div className="bg-[#181818] rounded-xl p-2">
                <p className="text-[10px] text-gray-500">Week</p>
                <p className="text-sm font-semibold">₹{earningsSummary.weekly?.total || 0}</p>
              </div>
              <div className="bg-[#181818] rounded-xl p-2">
                <p className="text-[10px] text-gray-500">Month</p>
                <p className="text-sm font-semibold">₹{earningsSummary.monthly?.total || 0}</p>
              </div>
            </div>
          </div>
        )}

        {/* Wallet */}
        <div className="bg-[#111] border border-[#222] rounded-2xl p-4">
          <div className="flex justify-between items-center">
            <p className="text-xs text-gray-400 tracking-widest">WALLET</p>
            <button onClick={withdrawFromWallet} className="text-[11px] px-2 py-1 rounded border border-[#333] text-gray-300 hover:text-white">
              Withdraw
            </button>
          </div>
          <p className="text-2xl font-bold mt-2">₹{wallet.balance || 0}</p>
          <p className="text-[11px] text-gray-500 mt-1">Recent transactions: {wallet.transactions?.length || 0}</p>
        </div>

        {/* Verification + SOS */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-[#111] border border-[#222] rounded-2xl p-4">
            <p className="text-xs text-gray-400 tracking-widest">VERIFICATION</p>
            <p className="text-sm mt-2 capitalize">{verification.status || "notSubmitted"}</p>
            {verification.status !== "approved" && (
              <button onClick={submitVerification} className="mt-3 text-[11px] px-2 py-1 rounded border border-[#333] text-gray-300 hover:text-white">
                Submit docs
              </button>
            )}
          </div>
          <button onClick={triggerSOS} className="bg-red-500/10 border border-red-500/40 rounded-2xl p-4 text-left hover:bg-red-500/20 transition-colors">
            <p className="text-xs text-red-300 tracking-widest">EMERGENCY</p>
            <p className="text-sm font-semibold mt-2 text-red-200">SOS Alert</p>
            <p className="text-[11px] text-red-300/80 mt-1">Send emergency signal now</p>
          </button>
        </div>

        {/* Online toggle */}
        <div className="bg-[#111] border border-[#222] rounded-2xl p-6 space-y-3">
          <div className="flex justify-between items-center">
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
              className={`w-14 h-7 rounded-full transition-colors relative ${isOnline ? "bg-white" : "bg-[#333]"}`}
            >
              <span className={`absolute top-1 w-5 h-5 rounded-full transition-all ${isOnline ? "right-1 bg-black" : "left-1 bg-[#666]"}`} />
            </button>
          </div>
          {/* Live location status */}
          {locationStatus && (
            <p className="text-xs text-green-400 font-mono">{locationStatus}</p>
          )}
        </div>

        {/* Incoming ride request */}
        {rideRequest && (
          <div className="bg-[#111] border border-white rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-400 tracking-widest">NEW RIDE REQUEST</p>
              <span className={`text-xs font-semibold ${requestTimer <= 8 ? "text-red-400" : "text-amber-300"}`}>
                expires in {requestTimer}s
              </span>
            </div>
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
                <span className="text-white capitalize inline-flex items-center gap-1.5">
                  <VehicleIcon vehicleType={rideRequest.rideType} size={14} color="#9CA3AF" />
                  {rideRequest.rideType}
                </span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 pt-2">
              <button onClick={rejectRide}
                className="py-3 rounded-xl border border-[#333] text-gray-400 text-sm hover:border-[#555] transition-colors">
                Decline
              </button>
              <button onClick={acceptRide}
                className="py-3 rounded-xl bg-white text-black text-sm font-medium hover:bg-gray-100 transition-colors">
                Accept
              </button>
            </div>
          </div>
        )}

        {/* Requested rides list */}
        {isOnline && (
          <div className="bg-[#111] border border-[#222] rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-400 tracking-widest">REQUESTED RIDES</p>
              <button
                onClick={fetchRequestedRides}
                className="text-[11px] px-2 py-1 rounded border border-[#333] text-gray-300 hover:text-white"
              >
                Refresh
              </button>
            </div>
            {loadingRequestedRides ? (
              <p className="text-xs text-gray-500">Loading requests...</p>
            ) : requestedRides.length === 0 ? (
              <p className="text-xs text-gray-600">No open ride requests</p>
            ) : (
              requestedRides.slice(0, 6).map((reqRide) => (
                <RideCard
                  key={reqRide._id}
                  ride={reqRide}
                  onAccept={acceptRequestedRide}
                  onReject={rejectRequestedRide}
                  busy={requestActionLoading}
                />
              ))
            )}
          </div>
        )}

        {/* Active ride */}
        {activeRide && (
          <div className="bg-[#111] border border-[#222] rounded-2xl overflow-hidden">
            <div className="p-5 space-y-4">
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
                <div className="flex gap-2 text-sm">
                  <span className="text-gray-500 w-20">Vehicle</span>
                  <span className="text-white capitalize inline-flex items-center gap-1.5">
                    <VehicleIcon vehicleType={activeRide.rideType} size={14} color="#9CA3AF" />
                    {activeRide.rideType || "standard"}
                  </span>
                </div>
              </div>
              <div className="space-y-2 pt-2">
                {activeRide.status !== "completed" && activeRide.status !== "cancelled" && (
                  <button
                    onClick={async () => {
                      if (!confirm("Cancel this ride?")) return;
                      try {
                        await api.delete(`/rides/${activeRideId}`, { data: { reason: "Driver cancelled" } });
                        setActiveRide(null);
                      } catch (err) {
                        alert("Cancellation failed");
                      }
                    }}
                    className="w-full py-3 rounded-xl border border-red-500/40 text-red-300 text-sm hover:border-red-400 transition-colors"
                  >
                    Cancel ride
                  </button>
                )}
                {(!activeRide.status || activeRide.status === "accepted") && (
                  <button onClick={() => updateStatus("arriving")}
                    className="w-full py-3 rounded-xl border border-[#333] text-white text-sm hover:border-[#555] transition-colors">
                    Arrived
                  </button>
                )}
                {activeRide.status === "arriving" && (
                  <button onClick={() => updateStatus("inProgress")}
                    className="w-full py-3 rounded-xl border border-[#333] text-white text-sm hover:border-[#555] transition-colors">
                    Start ride
                  </button>
                )}
                {activeRide.status === "inProgress" && (
                  <button onClick={() => updateStatus("completed")}
                    className="w-full py-3 rounded-xl bg-white text-black text-sm font-medium hover:bg-gray-100 transition-colors">
                    Complete ride
                  </button>
                )}
                <button
                  onClick={navigateToPickup}
                  disabled={navLoading}
                  className="w-full py-3 rounded-xl border border-blue-500/50 text-blue-300 text-sm hover:border-blue-400 transition-colors disabled:opacity-40"
                >
                  {navLoading ? "Loading route..." : "Navigate to Pickup"}
                </button>
              </div>
            </div>

            {/* ── Chat panel ── */}
            <div className="border-t border-[#1e1e1e]">

              {/* Chat header / toggle */}
              <button
                onClick={() => setChatOpen(o => !o)}
                className="w-full flex items-center justify-between px-5 py-3
                  hover:bg-[#1a1a1a] transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="text-base">💬</span>
                  <span className="text-sm font-medium text-white">Chat with rider</span>
                  {unread > 0 && (
                    <span className="w-5 h-5 rounded-full bg-green-400 text-black
                      text-xs font-bold flex items-center justify-center">{unread}</span>
                  )}
                </div>
                <span className="text-gray-500 text-xs">{chatOpen ? "▲ hide" : "▼ show"}</span>
              </button>

              {chatOpen && (
                <div className="bg-[#0a0a0a] border-t border-[#1e1e1e]">

                  {/* Quick reply chips */}
                  <div className="px-4 pt-3 pb-2 border-b border-[#1a1a1a]">
                    <p className="text-[10px] text-gray-600 mb-2 tracking-widest uppercase">Quick replies</p>
                    <div className="flex flex-wrap gap-2">
                      {(activeRide?.status === "arriving"
                        ? ["I've arrived! 🎯", "I'm outside", "Waiting near gate", "Please hurry out", "I'm parked nearby"]
                        : activeRide?.status === "inProgress"
                        ? ["We'll be there soon", "ETA ~10 mins 🗺️", "Slight detour, relax", "Traffic ahead", "Ride going great! 😊"]
                        : ["I'm on my way! 🚗", "~5 mins away", "Stuck in traffic", "I'm nearby now", "Please be ready"]
                      ).map(text => (
                        <button key={text} onClick={() => sendMessage(text)}
                          className="text-xs px-3 py-1.5 rounded-full border border-[#2a2a2a]
                            bg-[#161616] text-gray-300 hover:border-green-500/60 hover:text-white
                            active:scale-95 transition-all">
                          {text}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Message bubbles */}
                  <div className="h-52 overflow-y-auto px-4 py-3 space-y-2">
                    {messages.length === 0 ? (
                      <p className="text-center text-gray-600 text-xs mt-6">
                        No messages yet — tap a quick reply or type below
                      </p>
                    ) : messages.map((msg, i) => {
                      const isMe = msg.senderRole === "driver"; // driver's own = right
                      return (
                        <div key={i} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                          {/* Rider avatar on left */}
                          {!isMe && (
                            <div className="w-6 h-6 rounded-full bg-[#222] border border-[#333]
                              flex items-center justify-center text-xs shrink-0 mr-1.5 mt-1">
                              🧑
                            </div>
                          )}
                          <div className={`max-w-[72%] rounded-2xl px-3.5 py-2.5 ${
                            isMe
                              ? "bg-white text-black rounded-tr-sm"      // driver = white, right
                              : "bg-[#1e1e1e] text-white rounded-tl-sm border border-[#2a2a2a]" // rider = dark, left
                          }`}>
                            {!isMe && (
                              <p className="text-[10px] font-semibold text-green-400 mb-0.5">
                                {msg.senderName}
                              </p>
                            )}
                            <p className="text-sm leading-snug">{msg.message}</p>
                            <p className={`text-[9px] mt-1 ${isMe ? "text-gray-400 text-right" : "text-gray-600"}`}>
                              {new Date(msg.timestamp).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" })}
                            </p>
                          </div>
                          {/* Driver avatar on right */}
                          {isMe && (
                            <div className="w-6 h-6 rounded-full bg-white
                              flex items-center justify-center text-xs shrink-0 ml-1.5 mt-1">
                              🚗
                            </div>
                          )}
                        </div>
                      );
                    })}
                    <div ref={chatEndRef} />
                  </div>

                  {/* Custom message input */}
                  <div className="px-4 py-3 border-t border-[#1a1a1a] bg-[#0f0f0f]">
                    <p className="text-[10px] text-gray-600 mb-2 tracking-widest uppercase">Custom message</p>
                    <div className="flex gap-2">
                      <input
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && sendMessage()}
                        placeholder="Type anything to the rider..."
                        className="flex-1 bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl
                          px-4 py-2.5 text-sm text-white outline-none
                          focus:border-green-500/50 transition-colors placeholder-gray-600"
                      />
                      <button
                        onClick={() => sendMessage()}
                        disabled={!input.trim()}
                        className="w-10 h-10 rounded-xl bg-green-500 text-black flex items-center
                          justify-center font-bold text-sm disabled:opacity-30
                          disabled:bg-[#222] disabled:text-gray-600 shrink-0 transition-all"
                      >➤</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Scheduled rides */}
        <div className="bg-[#111] border border-[#222] rounded-2xl p-4">
          <p className="text-xs text-gray-400 tracking-widest mb-2">SCHEDULED RIDES</p>
          {scheduledRides.length === 0 ? (
            <p className="text-xs text-gray-600">No upcoming scheduled rides</p>
          ) : (
            scheduledRides.slice(0, 3).map((ride) => (
              <div key={ride._id} className="text-xs text-gray-300 py-1 border-b border-[#1a1a1a] last:border-0">
                {new Date(ride.scheduledAt).toLocaleString()} - {ride.pickup?.address}
              </div>
            ))
          )}
        </div>

        {/* Notifications */}
        <div className="bg-[#111] border border-[#222] rounded-2xl p-4">
          <p className="text-xs text-gray-400 tracking-widest mb-2">NOTIFICATIONS</p>
          {notifications.slice(0, 4).map((n) => (
            <button
              key={n._id}
              onClick={() => markAsRead(n._id)}
              className="w-full text-left py-2 border-b border-[#1a1a1a] last:border-0"
            >
              <p className={`text-xs ${n.read ? "text-gray-500" : "text-white"}`}>{n.title || "Update"}</p>
              <p className="text-[11px] text-gray-600">{n.message}</p>
            </button>
          ))}
          {notifications.length === 0 && <p className="text-xs text-gray-600">No notifications yet</p>}
        </div>

        {/* Heatmap demand zones */}
        <div className="bg-[#111] border border-[#222] rounded-2xl p-4">
          <p className="text-xs text-gray-400 tracking-widest mb-2">HIGH DEMAND ZONES</p>
          {heatmapZones.slice(0, 3).map((z, idx) => (
            <p key={`${z.lat}-${z.lng}-${idx}`} className="text-xs text-gray-300 py-1">
              {z.lat}, {z.lng} - {z.demand} requests
            </p>
          ))}
          {heatmapZones.length === 0 && <p className="text-xs text-gray-600">No demand data available</p>}
        </div>

        {/* Ride history with filters */}
        <div className="bg-[#111] border border-[#222] rounded-2xl p-4">
          <p className="text-xs text-gray-400 tracking-widest mb-3">RIDE HISTORY FILTERS</p>
          <div className="grid grid-cols-2 gap-2">
            <input type="date" value={historyFilters.from} onChange={(e) => setHistoryFilters((p) => ({ ...p, from: e.target.value }))} className="bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1 text-xs" />
            <input type="date" value={historyFilters.to} onChange={(e) => setHistoryFilters((p) => ({ ...p, to: e.target.value }))} className="bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1 text-xs" />
            <input type="number" placeholder="Min ₹" value={historyFilters.minEarnings} onChange={(e) => setHistoryFilters((p) => ({ ...p, minEarnings: e.target.value }))} className="bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1 text-xs" />
            <input type="number" placeholder="Min km" value={historyFilters.minDistance} onChange={(e) => setHistoryFilters((p) => ({ ...p, minDistance: e.target.value }))} className="bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1 text-xs" />
          </div>
          <button onClick={applyHistoryFilters} className="mt-2 w-full py-2 rounded-xl border border-[#333] text-xs text-gray-300 hover:text-white">Apply filters</button>
          <p className="text-xs text-gray-500 mt-2">Showing {history.length} rides</p>
        </div>

        <RideHistoryList rides={history} />

        {/* Empty states */}
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