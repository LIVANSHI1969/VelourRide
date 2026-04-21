import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { io } from "socket.io-client";
import api from "../services/api";
import { MapContainer, TileLayer, Marker, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

// ─── Inject animation CSS into <head> once ───────────────────────────────────
const STYLE_ID = "velour-driver-anim";
if (!document.getElementById(STYLE_ID)) {
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    @keyframes driverBob {
      0%,100% { transform: translateY(0px) scale(1); }
      50%      { transform: translateY(-9px) scale(1.12); }
    }
    @keyframes userPing {
      0%   { transform: scale(1); opacity: 0.85; }
      70%  { transform: scale(2.8); opacity: 0; }
      100% { transform: scale(2.8); opacity: 0; }
    }
    .vr-driver { animation: driverBob 1.3s ease-in-out infinite; transform-origin: bottom center; }
    .vr-user-ring { animation: userPing 1.9s ease-out infinite; }
  `;
  document.head.appendChild(s);
}

// ─── Vehicle config ───────────────────────────────────────────────────────────
const VEHICLE = {
  bike:     { emoji: "🏍️", color: "#10B981", label: "Bike" },
  auto:     { emoji: "🛺", color: "#F59E0B", label: "Auto" },
  standard: { emoji: "🚗", color: "#3B82F6", label: "Car" },
  comfort:  { emoji: "🚙", color: "#8B5CF6", label: "Comfort" },
  black:    { emoji: "🖤", color: "#E5E7EB", label: "Black" },
  parcel:   { emoji: "📦", color: "#EF4444", label: "Parcel" },
};

// ─── Build driver DivIcon — emoji bubble with glow + bounce ──────────────────
const makeDriverIcon = (rideType, index) => {
  const { emoji, color } = VEHICLE[rideType] || VEHICLE.standard;
  const delay = (index * 280) % 1120;
  return L.divIcon({
    className: "",
    html: `
      <div class="vr-driver" style="animation-delay:${delay}ms; filter:drop-shadow(0 6px 12px ${color}88);">
        <div style="
          width:46px; height:46px;
          background:#111;
          border:2.5px solid ${color};
          border-radius:50%;
          display:flex; align-items:center; justify-content:center;
          font-size:22px;
          box-shadow: 0 0 16px ${color}55, inset 0 0 8px #00000066;
        ">${emoji}</div>
      </div>`,
    iconSize:   [46, 46],
    iconAnchor: [23, 23],
  });
};

// ─── User location icon (pulsing white ring) ──────────────────────────────────
const USER_ICON = L.divIcon({
  className: "",
  html: `
    <div style="position:relative;width:22px;height:22px;">
      <div class="vr-user-ring" style="
        position:absolute; inset:0;
        border-radius:50%; background:white; opacity:0.85;">
      </div>
      <div style="
        position:absolute; inset:5px;
        border-radius:50%; background:white;
        border:2.5px solid #000;">
      </div>
    </div>`,
  iconSize:   [22, 22],
  iconAnchor: [11, 11],
});

// ─── Re-center map when coords change ────────────────────────────────────────
function MapCenterer({ coords }) {
  const map = useMap();
  useEffect(() => {
    if (coords) map.setView([coords.lat, coords.lng], 15, { animate: true });
  }, [coords?.lat, coords?.lng]);
  return null;
}

// ─── Status labels ────────────────────────────────────────────────────────────
const STATUS_LABELS = {
  searching:  "Finding your driver...",
  accepted:   "Driver accepted — heading to you",
  arriving:   "Driver is arriving",
  inProgress: "Ride in progress",
  completed:  "Ride completed ✓",
  cancelled:  "Ride cancelled",
};

// ─── Component ────────────────────────────────────────────────────────────────
export default function RideTracking() {
  const { id }   = useParams();
  const navigate = useNavigate();

  const [ride,          setRide]          = useState(null);
  const [status,        setStatus]        = useState("searching");
  const [userCoords,    setUserCoords]    = useState(null);
  const [drivers,       setDrivers]       = useState([]);   // real DB drivers
  const [driverPos,     setDriverPos]     = useState([]);   // live positions (drift)
  const pollRef = useRef(null);

  // ── Get exact user GPS location ──────────────────────────────────────────
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => setUserCoords({ lat: coords.latitude, lng: coords.longitude }),
      () => {},
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, []);

  // ── Fetch ride details ───────────────────────────────────────────────────
  useEffect(() => {
    const fetchRide = async () => {
      try {
        const { data } = await api.get(`/rides/${id}`);
        setRide(data.ride);
        setStatus(data.ride.status);
      } catch (err) {
        console.error("Ride fetch failed:", err);
      }
    };
    fetchRide();
  }, [id]);

  // ── Poll nearby drivers every 6 s ────────────────────────────────────────
  useEffect(() => {
    const center = userCoords || ride?.pickup?.coordinates;
    if (!center || !ride) return;

    const fetchDrivers = async () => {
      try {
        const { data } = await api.get("/drivers/nearby", {
          params: {
            lat:      center.lat,
            lng:      center.lng,
            radius:   6,
            rideType: ride.rideType,
          },
        });

        const list = (data.drivers || []).map((d) => ({
          _id:      d._id,
          name:     d.name,
          rideType: d.vehicle?.type || ride.rideType,
          lat:      d.location?.coordinates?.[1],
          lng:      d.location?.coordinates?.[0],
        })).filter((d) => d.lat && d.lng);

        setDrivers(list);
        setDriverPos(list.map((d) => ({ lat: d.lat, lng: d.lng })));
      } catch (err) {
        console.error("Nearby drivers fetch failed:", err);
      }
    };

    fetchDrivers();
    pollRef.current = setInterval(fetchDrivers, 6000);
    return () => clearInterval(pollRef.current);
  }, [ride, userCoords]);

  // ── Gentle drift animation between real polls ─────────────────────────────
  useEffect(() => {
    if (!drivers.length) return;
    const iv = setInterval(() => {
      setDriverPos((prev) =>
        prev.map((p) => ({
          lat: p.lat + (Math.random() - 0.5) * 0.00025,
          lng: p.lng + (Math.random() - 0.5) * 0.00025,
        }))
      );
    }, 1800);
    return () => clearInterval(iv);
  }, [drivers]);

  // ── Socket for live status updates ───────────────────────────────────────
  useEffect(() => {
    const socket = io(import.meta.env.VITE_SOCKET_URL || "http://localhost:5000");
    socket.emit("joinRide", id);
    socket.on("rideStatusUpdate", ({ status }) => {
      setStatus(status);
      if (status === "completed") setTimeout(() => navigate("/ride"), 3000);
    });
    socket.on("rideAccepted", () => setStatus("accepted"));
    return () => socket.disconnect();
  }, [id]);

  const mapCenter = userCoords || ride?.pickup?.coordinates || { lat: 28.6139, lng: 77.209 };
  const rideType  = ride?.rideType || "standard";
  const vehicle   = VEHICLE[rideType] || VEHICLE.standard;

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">

      {/* ── Header ── */}
      <div className="border-b border-[#1a1a1a] px-6 py-4 flex justify-between items-center">
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
          <button
            onClick={() => navigate("/ride")}
            className="text-xs text-gray-600 hover:text-white py-2 px-3 border border-gray-600 rounded-lg transition-colors"
          >{status === "completed" ? "Home" : "Back"}</button>
        </div>
      </div>

      {/* ── Map ── */}
      <div className="relative" style={{ height: 430 }}>
        <MapContainer
          center={[mapCenter.lat, mapCenter.lng]}
          zoom={15}
          style={{ height: "100%", width: "100%" }}
          zoomControl={true}
          scrollWheelZoom={true}
          dragging={true}
        >
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            attribution="&copy; CARTO"
          />

          <MapCenterer coords={mapCenter} />

          {/* User location pin */}
          {userCoords && (
            <Marker position={[userCoords.lat, userCoords.lng]} icon={USER_ICON} />
          )}

          {/* Driver markers — real positions from DB with gentle drift */}
          {driverPos.map((pos, i) => (
            <Marker
              key={drivers[i]?._id || `d-${i}`}
              position={[pos.lat, pos.lng]}
              icon={makeDriverIcon(drivers[i]?.rideType || rideType, i)}
              title={drivers[i]?.name}
            />
          ))}
        </MapContainer>

        {/* Status pill */}
        <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-[999]
          bg-[#111]/95 border border-[#2a2a2a] rounded-full px-5 py-2.5
          flex items-center gap-2 shadow-xl">
          <span className="w-2 h-2 bg-white rounded-full animate-pulse" />
          <span className="text-sm text-gray-300 whitespace-nowrap">
            {STATUS_LABELS[status] || status}
          </span>
        </div>

        {/* Driver count badge */}
        <div className="absolute top-4 right-4 z-[999]
          bg-[#111]/90 border border-[#333] rounded-xl px-3 py-2">
          <p className="text-xs text-gray-400">
            {drivers.length > 0
              ? `${drivers.length} ${vehicle.label} nearby`
              : "Searching..."}
          </p>
        </div>
      </div>

      {/* ── Ride details ── */}
      {ride && (
        <div className="bg-[#111] border-t border-[#222] px-6 py-5 space-y-4">

          {/* Driver info (if assigned) or vehicle type while searching */}
          {ride.driver ? (
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
          ) : (
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-[#1a1a1a] border border-[#333]
                flex items-center justify-center text-2xl">
                {vehicle.emoji}
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium">{vehicle.label} ride</p>
                <p className="text-xs animate-pulse" style={{ color: vehicle.color }}>
                  Looking for nearby drivers...
                </p>
              </div>
              {ride.fare?.total ? <p className="text-lg font-medium">₹{ride.fare.total}</p> : null}
            </div>
          )}

          {/* Route */}
          <div className="space-y-2 pt-1">
            <div className="flex gap-3 text-sm items-start">
              <span className="w-2 h-2 rounded-full bg-white mt-1.5 shrink-0" />
              <span className="text-gray-300">{ride.pickup?.address}</span>
            </div>
            <div className="ml-[3px] w-px h-4 bg-[#333]" />
            <div className="flex gap-3 text-sm items-start">
              <span className="w-2 h-2 rounded-full border border-gray-500 mt-1.5 shrink-0" />
              <span className="text-gray-300">{ride.destination?.address}</span>
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