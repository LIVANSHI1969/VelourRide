import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { io } from "socket.io-client";
import api from "../services/api";
import { MapContainer, TileLayer, Marker, Polyline, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useAuth } from "../context/AuthContext";

// ─── Inject CSS once ──────────────────────────────────────────────────────────
(() => {
  if (document.getElementById("vr-styles")) return;
  const s = document.createElement("style");
  s.id = "vr-styles";
  s.textContent = `
    .vr-wrap{background:transparent!important;border:none!important;box-shadow:none!important;overflow:visible!important;}
    @keyframes vrBob{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-8px) scale(1.1)}}
    @keyframes vrPulse{0%{transform:scale(1);opacity:.8}70%,100%{transform:scale(2.8);opacity:0}}
    @keyframes vrDash{to{stroke-dashoffset:-20}}
    .vr-bob{animation:vrBob 1.4s ease-in-out infinite;transform-origin:bottom center;}
    .vr-pulse{animation:vrPulse 1.9s ease-out infinite;}
    .vr-dash{animation:vrDash .45s linear infinite;}
  `;
  document.head.appendChild(s);
})();

const VEHICLE = {
  bike:     { emoji:"🏍️", color:"#10B981", label:"Bike"    },
  auto:     { emoji:"🛺",  color:"#F59E0B", label:"Auto"    },
  standard: { emoji:"🚗",  color:"#3B82F6", label:"Car"     },
  comfort:  { emoji:"🚙",  color:"#8B5CF6", label:"Comfort" },
  black:    { emoji:"🚖",  color:"#D1D5DB", label:"Black"   },
  parcel:   { emoji:"📦",  color:"#EF4444", label:"Parcel"  },
};

const makeDriverIcon = (rideType) => {
  const { emoji, color } = VEHICLE[rideType] || VEHICLE.standard;
  return L.divIcon({
    className: "vr-wrap",
    html: `<div class="vr-bob" style="filter:drop-shadow(0 6px 14px ${color}bb);">
      <div style="width:52px;height:52px;background:#111;border:3px solid ${color};
        border-radius:50%;display:flex;align-items:center;justify-content:center;
        font-size:26px;line-height:1;box-shadow:0 0 22px ${color}55;">${emoji}</div>
    </div>`,
    iconSize:[52,52], iconAnchor:[26,26],
  });
};

const USER_ICON = L.divIcon({
  className: "vr-wrap",
  html: `<div style="position:relative;width:26px;height:26px;">
    <div class="vr-pulse" style="position:absolute;inset:0;border-radius:50%;background:white;"></div>
    <div style="position:absolute;inset:5px;border-radius:50%;background:white;border:2.5px solid #000;box-shadow:0 0 0 2px white;"></div>
  </div>`,
  iconSize:[26,26], iconAnchor:[13,13],
});

function MapCenterer({ coords }) {
  const map = useMap();
  useEffect(() => {
    if (coords) map.setView([coords.lat, coords.lng], 15, { animate:true });
  }, [coords?.lat, coords?.lng]);
  return null;
}

function FollowDriver({ pos }) {
  const map = useMap();
  const first = useRef(true);
  useEffect(() => {
    if (!pos) return;
    if (first.current) { map.setView([pos.lat, pos.lng], 15, { animate:true }); first.current = false; return; }
    const b = map.getBounds(), pad = 0.0008;
    if (pos.lat < b.getSouth()+pad || pos.lat > b.getNorth()-pad ||
        pos.lng < b.getWest()+pad  || pos.lng > b.getEast()-pad)
      map.panTo([pos.lat, pos.lng], { animate:true, duration:1.2 });
  }, [pos]);
  return null;
}

const STATUS_LABELS = {
  searching:  "Finding your driver...",
  accepted:   "Driver accepted — heading to you",
  arriving:   "Driver is arriving",
  inProgress: "Ride in progress",
  completed:  "Ride completed ✓",
  cancelled:  "Ride cancelled",
};

const lerp = (a, b, t) => a + (b - a) * t;

async function fetchRoadRoute(from, to) {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/`
      + `${from.lng},${from.lat};${to.lng},${to.lat}`
      + `?overview=full&geometries=geojson&steps=false`;
    const res  = await fetch(url, { signal: AbortSignal.timeout(6000) });
    const data = await res.json();
    if (data.code !== "Ok" || !data.routes?.[0]) return null;
    return data.routes[0].geometry.coordinates.map(([lng,lat]) => ({ lat, lng }));
  } catch { return null; }
}

// ─── Rider quick replies ──────────────────────────────────────────────────────
const RIDER_QUICK_REPLIES = [
  "Ok, I'm ready 👍",
  "I'm outside waiting",
  "Please hurry!",
  "Where are you exactly?",
  "I'll be there in 2 mins",
  "Can you call me?",
];

export default function RideTracking() {
  const { id }   = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  // Use a ref for the socket so it's always current inside listeners
  const socketRef   = useRef(null);
  // Use a ref for chatOpen so socket listeners always see the latest value
  const chatOpenRef = useRef(false);

  const [ride,         setRide]         = useState(null);
  const [status,       setStatus]       = useState("searching");
  const [userCoords,   setUserCoords]   = useState(null);
  const [driver,       setDriver]       = useState(null);
  const [driverPos,    setDriverPos]    = useState(null);
  const [routePoints,  setRoutePoints]  = useState([]);
  const [routeIdx,     setRouteIdx]     = useState(0);
  const [traveledRoute,setTraveledRoute]= useState([]);
  const [aheadRoute,   setAheadRoute]   = useState([]);
  const [eta,          setEta]          = useState(null);

  // Chat
  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input,    setInput]    = useState("");
  const [unread,   setUnread]   = useState(0);
  const chatEndRef = useRef(null);

  // Keep chatOpenRef in sync with state
  useEffect(() => { chatOpenRef.current = chatOpen; }, [chatOpen]);

  // ── GPS ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => setUserCoords({ lat: coords.latitude, lng: coords.longitude }),
      () => {},
      { enableHighAccuracy:true, timeout:10000 }
    );
  }, []);

  // ── Fetch ride ────────────────────────────────────────────────────────────
  useEffect(() => {
    api.get(`/rides/${id}`)
      .then(({ data }) => { setRide(data.ride); setStatus(data.ride.status); })
      .catch(console.error);
  }, [id]);

  // ── Socket setup — only once ──────────────────────────────────────────────
  useEffect(() => {
    const socket = io(import.meta.env.VITE_SOCKET_URL || "http://localhost:5000");
    socketRef.current = socket;

    socket.emit("joinRide", id);

    socket.on("rideStatusUpdate", ({ status: s }) => {
      setStatus(s);
      if (s === "completed") setTimeout(() => navigate("/ride"), 3000);
    });

    socket.on("rideAccepted", () => setStatus("accepted"));

    // Use chatOpenRef (not chatOpen state) so we always see current value
    socket.on("chatMessage", (msg) => {
      setMessages(prev => [...prev, msg]);
      if (!chatOpenRef.current) setUnread(u => u + 1);
    });

    return () => { socket.disconnect(); socketRef.current = null; };
  }, [id]);

  // Clear unread + scroll when chat opens
  useEffect(() => {
    if (chatOpen) { setUnread(0); chatEndRef.current?.scrollIntoView({ behavior:"smooth" }); }
  }, [chatOpen]);

  // Auto-scroll on new message
  useEffect(() => {
    if (chatOpen) chatEndRef.current?.scrollIntoView({ behavior:"smooth" });
  }, [messages]);

  const sendMessage = (text) => {
    const msg = (text || input).trim();
    if (!msg || !socketRef.current) return;
    socketRef.current.emit("chatMessage", {
      rideId: id, message: msg,
      senderName: user?.name || "Rider", senderRole: "rider",
    });
    if (!text) setInput(""); // only clear input if typed (not quick reply)
  };

  // ── Pick driver + fetch route ─────────────────────────────────────────────
  useEffect(() => {
    const center = userCoords || ride?.pickup?.coordinates;
    if (!center || !ride) return;

    const pick = async () => {
      let startPos, driverInfo;
      try {
        const { data } = await api.get("/drivers/nearby", {
          params: { lat: center.lat, lng: center.lng, radius: 15 },
        });
        const list = (data.drivers || [])
          .filter(d => d.location?.coordinates?.[0] && d.location?.coordinates?.[1]);
        if (list.length > 0) {
          const d = list[0];
          startPos   = { lat: d.location.coordinates[1], lng: d.location.coordinates[0] };
          driverInfo = { name: d.name, rideType: d.vehicle?.type || ride.rideType,
                         rating: d.rating, vehicle: d.vehicle };
        }
      } catch { /* ignore */ }

      if (!startPos) {
        startPos   = { lat: center.lat + 0.012, lng: center.lng + 0.015 };
        driverInfo = { name: "Your Driver", rideType: ride.rideType, rating: 4.9 };
      }

      setDriver({ ...driverInfo, ...startPos });
      setDriverPos({ ...startPos });

      const dest = userCoords || center;
      const road = await fetchRoadRoute(startPos, dest);

      if (road && road.length > 1) {
        setRoutePoints(road);
        setAheadRoute(road);
        setTraveledRoute([startPos]);
      } else {
        const steps = 40;
        const straight = Array.from({ length: steps + 1 }, (_, i) => ({
          lat: lerp(startPos.lat, dest.lat, i / steps),
          lng: lerp(startPos.lng, dest.lng, i / steps),
        }));
        setRoutePoints(straight);
        setAheadRoute(straight);
        setTraveledRoute([startPos]);
      }
    };

    pick();
  }, [ride, userCoords]);

  // ── Animate driver along route ────────────────────────────────────────────
  useEffect(() => {
    if (!routePoints.length) return;
    const SPEED = 2, TICK = 1600;
    const iv = setInterval(() => {
      setRouteIdx(prev => {
        const next = Math.min(prev + SPEED, routePoints.length - 1);
        setDriverPos({ ...routePoints[next] });
        setTraveledRoute(routePoints.slice(0, next + 1));
        setAheadRoute(routePoints.slice(next));
        setEta(Math.max(1, Math.round(((routePoints.length - next) * TICK) / 60000)));
        return next;
      });
    }, TICK);
    return () => clearInterval(iv);
  }, [routePoints]);

  const rideType  = ride?.rideType || "standard";
  const vehicle   = VEHICLE[rideType] || VEHICLE.standard;
  const mapCenter = userCoords || ride?.pickup?.coordinates || { lat:28.6139, lng:77.209 };

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">

      {/* Header */}
      <div className="border-b border-[#1a1a1a] px-6 py-4 flex justify-between items-center shrink-0">
        <div>
          <h1 className="text-lg tracking-[0.2em] font-light">VELOUR</h1>
          <p className="text-xs text-gray-600 tracking-widest">RIDE</p>
        </div>
        <div className="flex gap-2">
          {!["completed","cancelled","inProgress"].includes(status) && (
            <button
              onClick={async () => {
                if (!confirm("Cancel this ride?")) return;
                try { await api.delete(`/rides/${id}`); navigate("/ride"); }
                catch { alert("Cancel failed"); }
              }}
              className="text-xs text-red-400 hover:text-red-300 py-2 px-3 border border-red-500/30 rounded-lg transition-colors"
            >Cancel</button>
          )}
          <button onClick={() => navigate("/ride")}
            className="text-xs text-gray-600 hover:text-white py-2 px-3 border border-gray-600 rounded-lg transition-colors">
            {status === "completed" ? "Home" : "Back"}
          </button>
        </div>
      </div>

      {/* Map */}
      <div className="relative shrink-0" style={{ height: 400 }}>
        <MapContainer center={[mapCenter.lat, mapCenter.lng]} zoom={15}
          style={{ height:"100%", width:"100%" }} zoomControl scrollWheelZoom dragging>
          <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" attribution="&copy; CARTO" />
          <MapCenterer coords={mapCenter} />
          {driverPos && <FollowDriver pos={driverPos} />}

          {traveledRoute.length > 1 && (
            <Polyline positions={traveledRoute.map(p=>[p.lat,p.lng])}
              pathOptions={{ color:"#444", weight:3, opacity:0.5 }} />
          )}
          {aheadRoute.length > 1 && (
            <Polyline positions={aheadRoute.map(p=>[p.lat,p.lng])}
              pathOptions={{ color: vehicle.color, weight:4, opacity:0.85 }} />
          )}
          {aheadRoute.length > 1 && (
            <Polyline positions={aheadRoute.map(p=>[p.lat,p.lng])}
              pathOptions={{ color:"#fff", weight:2, opacity:0.35, dashArray:"10 10", className:"vr-dash" }} />
          )}
          {userCoords && <Marker position={[userCoords.lat, userCoords.lng]} icon={USER_ICON} />}
          {driverPos && <Marker position={[driverPos.lat, driverPos.lng]}
            icon={makeDriverIcon(driver?.rideType || rideType)} title={driver?.name} />}
        </MapContainer>

        {/* Status + ETA */}
        <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-[999]
          bg-[#111]/95 border border-[#2a2a2a] rounded-full px-5 py-2.5
          flex items-center gap-2.5 shadow-xl pointer-events-none">
          <span className="w-2 h-2 rounded-full animate-pulse shrink-0" style={{ background: vehicle.color }} />
          <span className="text-sm text-gray-300 whitespace-nowrap">{STATUS_LABELS[status] || status}</span>
          {eta && status === "searching" && (
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
              style={{ background: vehicle.color+"33", color: vehicle.color }}>~{eta} min</span>
          )}
        </div>

        {/* Driver tag */}
        {driver && (
          <div className="absolute top-4 left-4 z-[999] bg-[#111]/90 border border-[#333] rounded-xl px-3 py-2 pointer-events-none">
            <p className="text-xs font-semibold text-white">{driver.name}</p>
            <p className="text-[10px] mt-0.5" style={{ color: vehicle.color }}>
              {vehicle.emoji} {vehicle.label}{driver.rating ? ` · ★${driver.rating}` : ""}
            </p>
          </div>
        )}
      </div>

      {/* ── Driver card + Chat — always visible ── */}
      <div className="flex flex-col flex-1 bg-[#0f0f0f]">

        {/* Driver card */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[#1e1e1e]">
          <div className="w-12 h-12 rounded-full shrink-0 flex items-center justify-center text-2xl border-2"
            style={{ background:"#1a1a1a", borderColor: vehicle.color+"66" }}>
            {vehicle.emoji}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-white truncate">
                {ride?.driver?.name || driver?.name || "Finding driver..."}
              </p>
              {(ride?.driver?.rating || driver?.rating) && (
                <span className="text-xs font-medium shrink-0" style={{ color: vehicle.color }}>
                  ★ {Number(ride?.driver?.rating || driver?.rating).toFixed(1)}
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500 truncate mt-0.5">
              {ride?.driver?.vehicle?.model || driver?.vehicle?.model || vehicle.label}
              {(ride?.driver?.vehicle?.plate || driver?.vehicle?.plate) && (
                <span className="ml-2 font-mono text-[10px] bg-[#222] text-gray-300 px-1.5 py-0.5 rounded">
                  {ride?.driver?.vehicle?.plate || driver?.vehicle?.plate}
                </span>
              )}
            </p>
          </div>
          {ride?.fare?.total && (
            <p className="text-base font-bold text-white shrink-0">₹{ride.fare.total}</p>
          )}
        </div>

        {/* Route row */}
        {ride && (
          <div className="px-4 py-2.5 border-b border-[#1e1e1e] space-y-1.5">
            <div className="flex gap-2.5 items-center text-xs text-gray-400">
              <span className="w-2 h-2 rounded-full bg-white shrink-0" />
              <span className="truncate">{ride.pickup?.address}</span>
            </div>
            <div className="flex gap-2.5 items-center text-xs text-gray-400">
              <span className="w-2 h-2 rounded-full border border-gray-500 shrink-0" />
              <span className="truncate">{ride.destination?.address}</span>
            </div>
          </div>
        )}

        {/* Chat section header */}
        <button
          onClick={() => setChatOpen(o => !o)}
          className="flex items-center justify-between px-4 py-2.5 border-b border-[#1e1e1e]
            hover:bg-[#1a1a1a] transition-colors w-full"
        >
          <div className="flex items-center gap-2">
            <span className="text-base">💬</span>
            <span className="text-sm text-gray-300">Chat with driver</span>
            {unread > 0 && (
              <span className="w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center"
                style={{ background: vehicle.color, color:"#000" }}>{unread}</span>
            )}
          </div>
          <span className="text-gray-600 text-xs">{chatOpen ? "▲ hide" : "▼ show"}</span>
        </button>

        {/* Quick replies — always show */}
        <div className="px-4 pt-3 pb-2 border-b border-[#1e1e1e]">
          <p className="text-[10px] text-gray-600 mb-2 tracking-wider">QUICK REPLIES</p>
          <div className="flex flex-wrap gap-2">
            {RIDER_QUICK_REPLIES.map(text => (
              <button key={text} onClick={() => sendMessage(text)}
                className="text-xs px-3 py-1.5 rounded-full border border-[#2a2a2a]
                  bg-[#1a1a1a] text-gray-300 hover:border-white hover:text-white
                  active:scale-95 transition-all">
                {text}
              </button>
            ))}
          </div>
        </div>

        {/* Messages — shown when chat is open */}
        {chatOpen && (
          <>
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2" style={{ minHeight:120 }}>
              {messages.length === 0 ? (
                <p className="text-center text-gray-600 text-xs mt-4">Say hi to your driver 👋</p>
              ) : messages.map((msg, i) => {
                const isMe = msg.senderRole === "rider";
                return (
                  <div key={i} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[78%] rounded-2xl px-3.5 py-2 ${
                      isMe ? "bg-white text-black rounded-br-sm"
                           : "bg-[#1e1e1e] text-white rounded-bl-sm border border-[#2a2a2a]"
                    }`}>
                      {!isMe && (
                        <p className="text-[10px] font-semibold mb-0.5" style={{ color: vehicle.color }}>
                          {msg.senderName}
                        </p>
                      )}
                      <p className="text-sm leading-snug">{msg.message}</p>
                      <p className={`text-[9px] mt-0.5 ${isMe ? "text-gray-400" : "text-gray-600"}`}>
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" })}
                      </p>
                    </div>
                  </div>
                );
              })}
              <div ref={chatEndRef} />
            </div>

            {/* Type input */}
            <div className="flex gap-2 px-4 py-3 border-t border-[#1e1e1e] shrink-0">
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && sendMessage()}
                placeholder="Type a message..."
                className="flex-1 bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl px-4 py-2.5
                  text-sm text-white outline-none focus:border-[#555] transition-colors"
              />
              <button onClick={() => sendMessage()} disabled={!input.trim()}
                style={{ background: input.trim() ? vehicle.color : "#222" }}
                className="w-10 h-10 rounded-xl flex items-center justify-center font-bold
                  text-black transition-colors disabled:opacity-40 shrink-0">➤</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}