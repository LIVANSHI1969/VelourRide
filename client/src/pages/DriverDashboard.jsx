import { useState, useEffect, useRef } from "react";
import { useAuth } from "../context/AuthContext";
import { io } from "socket.io-client";
import api from "../services/api";

export default function DriverDashboard() {
  const { user, logout } = useAuth();
  const [isOnline, setIsOnline]       = useState(false);
  const [rideRequest, setRideRequest] = useState(null);
  const [activeRide, setActiveRide]   = useState(null);
  const [socket, setSocket]           = useState(null);
  const [earnings, setEarnings]       = useState({ total: 0, recentRides: [] });
  const [loadingEarnings, setLoadingEarnings] = useState(true);
  const [locationStatus, setLocationStatus]   = useState("");
  const watchRef = useRef(null);

  // Chat
  const [chatOpen,  setChatOpen]  = useState(false);
  const [messages,  setMessages]  = useState([]);
  const [input,     setInput]     = useState("");
  const [unread,    setUnread]    = useState(0);
  const chatEndRef  = useRef(null);
  const socketRef   = useRef(null);

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

  // Keep chatOpenRef in sync — lets socket listener read latest value without stale closure
  const chatOpenRef = useRef(false);
  useEffect(() => { chatOpenRef.current = chatOpen; }, [chatOpen]);

  useEffect(() => {
    const s = io(import.meta.env.VITE_SOCKET_URL || "http://localhost:5000");
    setSocket(s);
    socketRef.current = s;

    s.on("chatMessage", (msg) => {
      setMessages(prev => [...prev, msg]);
      if (!chatOpenRef.current) setUnread(u => u + 1);  // ref always current
    });

    return () => s.disconnect();
  }, []);

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
          await api.put("/drivers/location", { lat, lng });
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
  }, [isOnline]);

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
      // Use socketRef.current — guaranteed to be the live socket, not stale state
      socketRef.current?.emit("acceptRide", { rideId: rideRequest.rideId, driverId: user.id });
      socketRef.current?.emit("joinRide", rideRequest.rideId);  // join room for chat
      setMessages([]);
      setActiveRide(rideRequest);
      setRideRequest(null);
    } catch (err) { console.error(err); }
  };

  // Chat helpers
  const sendMessage = () => {
    const text = input.trim();
    const rideId = activeRide?.rideId;
    if (!text || !rideId || !socketRef.current) return;
    socketRef.current.emit("chatMessage", {
      rideId,
      message:    text,
      senderName: user?.name || "Driver",
      senderRole: "driver",
    });
    setInput("");
  };

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior:"smooth" }); }, [messages, chatOpen]);
  useEffect(() => { if (chatOpen) setUnread(0); }, [chatOpen]);

  const rejectRide = () => setRideRequest(null);

  const updateStatus = async (status) => {
    try {
      await api.put(`/rides/${activeRide.rideId}/status`, { status });
      if (status === "completed") setActiveRide(null);
      else setActiveRide({ ...activeRide, status });
    } catch (err) { console.error(err); }
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
          <p className="text-xs text-gray-500 mt-1">{earnings.recentRides?.length || 0} rides</p>
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
              </div>
              <div className="space-y-2 pt-2">
                {(!activeRide.status || activeRide.status === "accepted") && (
                  <button onClick={() => updateStatus("arriving")}
                    className="w-full py-3 rounded-xl border border-[#333] text-white text-sm hover:border-[#555] transition-colors">
                    I'm arriving
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
              </div>
            </div>

            {/* Chat toggle */}
            <div className="border-t border-[#1e1e1e]">
              <button
                onClick={() => setChatOpen(o => !o)}
                className="w-full flex items-center justify-between px-5 py-3 hover:bg-[#1a1a1a] transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="text-base">💬</span>
                  <span className="text-sm text-gray-300">Chat with rider</span>
                  {unread > 0 && (
                    <span className="w-5 h-5 rounded-full bg-green-400 text-black text-xs font-bold flex items-center justify-center">
                      {unread}
                    </span>
                  )}
                </div>
                <span className="text-gray-600 text-sm">{chatOpen ? "▲" : "▼"}</span>
              </button>

              {chatOpen && (
                <div className="border-t border-[#1e1e1e]">

                  {/* Quick reply chips — context-aware per ride status */}
                  <div className="px-4 pt-3 pb-2 bg-[#0d0d0d]">
                    <p className="text-[10px] text-gray-600 mb-2 tracking-wider">QUICK REPLIES</p>
                    <div className="flex flex-wrap gap-2">
                      {(
                        !activeRide?.status || activeRide?.status === "accepted"
                          ? [
                              "I'm on my way! 🚗",
                              "Will reach in ~5 mins",
                              "Stuck in traffic, coming soon",
                              "I'm nearby, please be ready",
                              "Can you share your exact location?",
                            ]
                          : activeRide?.status === "arriving"
                          ? [
                              "I've arrived! 🎯",
                              "I'm outside, look for me",
                              "Waiting at the pickup point",
                              "Please come quickly",
                              "I'm parked near the gate",
                            ]
                          : activeRide?.status === "inProgress"
                          ? [
                              "Ride is going great! 😊",
                              "We'll reach soon",
                              "Slight detour, don't worry",
                              "ETA ~10 mins",
                              "Traffic ahead, adjusting route",
                            ]
                          : [
                              "Hello! I'm your driver",
                              "On my way to pick you up",
                              "Please keep your phone handy",
                            ]
                      ).map((text) => (
                        <button
                          key={text}
                          onClick={() => {
                            const rideId = activeRide?.rideId;
                            if (!rideId || !socketRef.current) return;
                            socketRef.current.emit("chatMessage", {
                              rideId,
                              message:    text,
                              senderName: user?.name || "Driver",
                              senderRole: "driver",
                            });
                          }}
                          className="text-xs px-3 py-1.5 rounded-full border border-[#2a2a2a]
                            bg-[#1a1a1a] text-gray-300 hover:border-green-500/50
                            hover:text-white hover:bg-[#222] transition-all active:scale-95"
                        >
                          {text}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Messages */}
                  <div className="h-44 overflow-y-auto px-4 py-3 space-y-2 bg-[#0d0d0d]">
                    {messages.length === 0 && (
                      <p className="text-center text-gray-600 text-xs mt-4">
                        Tap a quick reply or type a message
                      </p>
                    )}
                    {messages.map((msg, i) => {
                      const isMe = msg.senderRole === "driver";
                      return (
                        <div key={i} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                          <div className={`max-w-[75%] rounded-2xl px-3.5 py-2 ${
                            isMe
                              ? "bg-white text-black rounded-br-sm"
                              : "bg-[#1e1e1e] text-white rounded-bl-sm border border-[#2a2a2a]"
                          }`}>
                            {!isMe && (
                              <p className="text-[10px] font-medium text-green-400 mb-0.5">{msg.senderName}</p>
                            )}
                            <p className="text-sm leading-snug">{msg.message}</p>
                            <p className={`text-[9px] mt-0.5 ${isMe ? "text-gray-500" : "text-gray-600"}`}>
                              {new Date(msg.timestamp).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" })}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                    <div ref={chatEndRef} />
                  </div>

                  {/* Custom input */}
                  <div className="flex gap-2 px-4 py-3 bg-[#0d0d0d] border-t border-[#1e1e1e]">
                    <input
                      value={input}
                      onChange={e => setInput(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && sendMessage()}
                      placeholder="Or type a custom message..."
                      className="flex-1 bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl px-4 py-2.5
                        text-sm text-white outline-none focus:border-green-500/50 transition-colors"
                    />
                    <button
                      onClick={sendMessage}
                      disabled={!input.trim()}
                      className="w-10 h-10 rounded-xl bg-white text-black flex items-center
                        justify-center text-sm font-bold disabled:opacity-30 shrink-0 transition-opacity"
                    >➤</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

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