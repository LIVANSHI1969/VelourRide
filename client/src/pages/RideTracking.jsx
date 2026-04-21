import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { io } from "socket.io-client";
import api from "../services/api";
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// ─── Vehicle SVG definitions per ride type ────────────────────────────────────
const VEHICLE_SVGS = {
  bike: (color) => `
    <svg width="36" height="36" viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg">
      <circle cx="18" cy="18" r="17" fill="#0f0f0f" stroke="${color}" stroke-width="1.5"/>
      <ellipse cx="18" cy="19" rx="7" ry="3.5" fill="${color}" opacity="0.9"/>
      <circle cx="11" cy="22" r="3" fill="none" stroke="${color}" stroke-width="1.8"/>
      <circle cx="25" cy="22" r="3" fill="none" stroke="${color}" stroke-width="1.8"/>
      <path d="M22 17 L26 15" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/>
      <circle cx="22" cy="13" r="2.5" fill="${color}" opacity="0.85"/>
      <path d="M11 19 L8 20" stroke="${color}" stroke-width="1" stroke-linecap="round" opacity="0.6"/>
    </svg>`,

  auto: (color) => `
    <svg width="36" height="36" viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg">
      <circle cx="18" cy="18" r="17" fill="#0f0f0f" stroke="${color}" stroke-width="1.5"/>
      <rect x="10" y="15" width="16" height="9" rx="2" fill="${color}" opacity="0.85"/>
      <path d="M12 15 Q13 10 23 10 Q25 10 26 15 Z" fill="${color}" opacity="0.7"/>
      <circle cx="13" cy="24" r="2.5" fill="none" stroke="${color}" stroke-width="1.8"/>
      <circle cx="23" cy="24" r="2.5" fill="none" stroke="${color}" stroke-width="1.8"/>
      <rect x="13" y="11" width="8" height="4" rx="1" fill="#0f0f0f" opacity="0.6"/>
      <line x1="10" y1="19" x2="26" y2="19" stroke="#0f0f0f" stroke-width="0.8" opacity="0.5"/>
    </svg>`,

  standard: (color) => `
    <svg width="36" height="36" viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg">
      <circle cx="18" cy="18" r="17" fill="#0f0f0f" stroke="${color}" stroke-width="1.5"/>
      <rect x="8" y="18" width="20" height="8" rx="2" fill="${color}" opacity="0.85"/>
      <path d="M12 18 L13 13 Q14 11 22 11 Q24 11 24 13 L25 18 Z" fill="${color}" opacity="0.8"/>
      <circle cx="12" cy="26" r="2.5" fill="none" stroke="${color}" stroke-width="1.8"/>
      <circle cx="24" cy="26" r="2.5" fill="none" stroke="${color}" stroke-width="1.8"/>
      <rect x="14" y="12.5" width="4" height="4" rx="0.5" fill="#0f0f0f" opacity="0.55"/>
      <rect x="19" y="12.5" width="4" height="4" rx="0.5" fill="#0f0f0f" opacity="0.55"/>
      <rect x="8" y="20" width="2" height="1.5" rx="0.5" fill="white" opacity="0.8"/>
      <rect x="26" y="20" width="2" height="1.5" rx="0.5" fill="white" opacity="0.8"/>
    </svg>`,

  comfort: (color) => `
    <svg width="36" height="36" viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg">
      <circle cx="18" cy="18" r="17" fill="#0f0f0f" stroke="${color}" stroke-width="1.5"/>
      <rect x="7" y="17" width="22" height="9" rx="2.5" fill="${color}" opacity="0.85"/>
      <path d="M10 17 L11 11 Q12 9 24 9 Q26 9 26 11 L27 17 Z" fill="${color}" opacity="0.75"/>
      <circle cx="12" cy="26" r="3" fill="none" stroke="${color}" stroke-width="2"/>
      <circle cx="24" cy="26" r="3" fill="none" stroke="${color}" stroke-width="2"/>
      <rect x="13" y="11" width="4.5" height="5" rx="0.5" fill="#0f0f0f" opacity="0.55"/>
      <rect x="18.5" y="11" width="4.5" height="5" rx="0.5" fill="#0f0f0f" opacity="0.55"/>
      <line x1="11" y1="9.5" x2="25" y2="9.5" stroke="${color}" stroke-width="1" opacity="0.5"/>
    </svg>`,

  black: (color) => `
    <svg width="36" height="36" viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg">
      <circle cx="18" cy="18" r="17" fill="#0f0f0f" stroke="${color}" stroke-width="1.5"/>
      <rect x="7" y="19" width="22" height="8" rx="2" fill="${color}" opacity="0.85"/>
      <path d="M11 19 L13 13 Q15 11 21 11 Q24 11 25 13 L27 19 Z" fill="${color}" opacity="0.75"/>
      <circle cx="12" cy="27" r="2.8" fill="none" stroke="${color}" stroke-width="2"/>
      <circle cx="24" cy="27" r="2.8" fill="none" stroke="${color}" stroke-width="2"/>
      <rect x="14" y="13" width="4" height="5" rx="0.5" fill="#111" opacity="0.8"/>
      <rect x="19" y="13" width="4" height="5" rx="0.5" fill="#111" opacity="0.8"/>
      <rect x="7" y="21" width="3" height="1" rx="0.5" fill="#555" opacity="0.9"/>
      <rect x="26" y="21" width="3" height="1" rx="0.5" fill="#555" opacity="0.9"/>
    </svg>`,

  parcel: (color) => `
    <svg width="36" height="36" viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg">
      <circle cx="18" cy="18" r="17" fill="#0f0f0f" stroke="${color}" stroke-width="1.5"/>
      <ellipse cx="18" cy="20" rx="6" ry="3" fill="${color}" opacity="0.85"/>
      <rect x="19" y="12" width="7" height="7" rx="1" fill="${color}" opacity="0.75"/>
      <line x1="19" y1="15.5" x2="26" y2="15.5" stroke="#0f0f0f" stroke-width="0.8" opacity="0.5"/>
      <line x1="22.5" y1="12" x2="22.5" y2="19" stroke="#0f0f0f" stroke-width="0.8" opacity="0.5"/>
      <circle cx="11" cy="23" r="3" fill="none" stroke="${color}" stroke-width="1.8"/>
      <circle cx="24" cy="23" r="3" fill="none" stroke="${color}" stroke-width="1.8"/>
      <circle cx="16" cy="14" r="2" fill="${color}" opacity="0.85"/>
    </svg>`,
};

const VEHICLE_COLORS = {
  bike:     '#10B981',
  auto:     '#F59E0B',
  standard: '#3B82F6',
  comfort:  '#8B5CF6',
  black:    '#E5E7EB',
  parcel:   '#EF4444',
};

// ─── Animated DivIcon factory ─────────────────────────────────────────────────
const makeDriverIcon = (rideType, index) => {
  const color  = VEHICLE_COLORS[rideType] || '#10B981';
  const svgFn  = VEHICLE_SVGS[rideType] || VEHICLE_SVGS.standard;
  const svgStr = svgFn(color);
  const delay  = (index * 280) % 1120;

  return L.divIcon({
    className: '',
    html: `
      <div style="
        animation: driverBounce 1.3s ease-in-out ${delay}ms infinite;
        transform-origin: bottom center;
        filter: drop-shadow(0 4px 10px ${color}66);
        cursor: pointer;
      ">${svgStr}</div>
      <style>
        @keyframes driverBounce {
          0%,100% { transform: translateY(0)   scale(1);    }
          50%      { transform: translateY(-7px) scale(1.1); }
        }
      </style>`,
    iconSize:   [36, 36],
    iconAnchor: [18, 18],
  });
};

// ─── Pulsing user-location icon ───────────────────────────────────────────────
const userLocationIcon = L.divIcon({
  className: '',
  html: `
    <div style="position:relative;width:20px;height:20px;">
      <div style="position:absolute;inset:0;border-radius:50%;background:white;
        animation:userPulse 1.8s ease-out infinite;"></div>
      <div style="position:absolute;inset:4px;border-radius:50%;background:white;
        border:2px solid #111;"></div>
    </div>
    <style>
      @keyframes userPulse{
        0%  {transform:scale(1);opacity:.8;}
        70% {transform:scale(2.6);opacity:0;}
        100%{transform:scale(2.6);opacity:0;}
      }
    </style>`,
  iconSize:   [20, 20],
  iconAnchor: [10, 10],
});

// ─── Mock drivers when API returns none ──────────────────────────────────────
const generateMockDrivers = (center, rideType) => {
  const offsets = [
    {  dlat:  0.008, dlng:  0.012 },
    {  dlat: -0.006, dlng:  0.009 },
    {  dlat:  0.011, dlng: -0.007 },
    {  dlat: -0.009, dlng: -0.013 },
    {  dlat:  0.003, dlng:  0.018 },
  ];
  return offsets.map((o, i) => ({
    _id: `mock_${i}`,
    name: `Driver ${i + 1}`,
    rideType,
    location: { lat: center.lat + o.dlat, lng: center.lng + o.dlng },
  }));
};

const driftPos = (pos) => ({
  lat: pos.lat + (Math.random() - 0.5) * 0.0003,
  lng: pos.lng + (Math.random() - 0.5) * 0.0003,
});

const STATUS_LABELS = {
  searching:  "Finding your driver...",
  accepted:   "Driver accepted — heading to you",
  arriving:   "Driver is arriving",
  inProgress: "Ride in progress",
  completed:  "Ride completed",
  cancelled:  "Ride cancelled",
};

const VEHICLE_ICONS = {
  bike: '🏍️', auto: '🛺', standard: '🚗',
  comfort: '🚙', black: '⬛', parcel: '📦',
};

function MapCenterer({ coords }) {
  const map = useMap();
  useEffect(() => { if (coords) map.setView([coords.lat, coords.lng], 15); }, [coords]);
  return null;
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function RideTracking() {
  const { id }   = useParams();
  const navigate = useNavigate();

  const [ride,            setRide]            = useState(null);
  const [status,          setStatus]          = useState("searching");
  const [nearbyDrivers,   setNearbyDrivers]   = useState([]);
  const [driverPositions, setDriverPositions] = useState([]);

  // ── Fetch ride & drivers ─────────────────────────────────────────────────
  useEffect(() => {
    const fetchRide = async () => {
      try {
        const { data } = await api.get(`/rides/${id}`);
        const r = data.ride;
        setRide(r);
        setStatus(r.status);

        if (r.pickup?.coordinates) {
          let drivers = [];
          try {
            const { data: dd } = await api.get('/drivers/nearby', {
              params: {
                lat:      r.pickup.coordinates.lat,
                lng:      r.pickup.coordinates.lng,
                radius:   5,
                rideType: r.rideType,
              },
            });
            drivers = (dd.drivers || [])
              .filter(d => d.location?.coordinates)
              .map(d => ({
                _id:      d._id,
                name:     d.name,
                rideType: r.rideType,
                location: {
                  lat: d.location.coordinates[1],
                  lng: d.location.coordinates[0],
                },
              }));
          } catch (_) {}

          if (drivers.length === 0)
            drivers = generateMockDrivers(r.pickup.coordinates, r.rideType);

          setNearbyDrivers(drivers);
          setDriverPositions(drivers.map(d => ({ ...d.location })));
        }
      } catch (err) {
        console.error(err);
      }
    };

    fetchRide();

    const socket = io(import.meta.env.VITE_SOCKET_URL || "http://localhost:5000");
    socket.emit("joinRide", id);
    socket.on("rideStatusUpdate", ({ status }) => {
      setStatus(status);
      if (status === "completed") setTimeout(() => navigate("/ride"), 3000);
    });
    socket.on("rideAccepted", () => setStatus("accepted"));
    return () => socket.disconnect();
  }, [id]);

  // ── Drift drivers every 1.5 s ─────────────────────────────────────────────
  useEffect(() => {
    if (!nearbyDrivers.length) return;
    const iv = setInterval(() => {
      setDriverPositions(prev => prev.map(p => driftPos(p)));
    }, 1500);
    return () => clearInterval(iv);
  }, [nearbyDrivers]);

  const pickupCoords = ride?.pickup?.coordinates;
  const rideType     = ride?.rideType || "standard";

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
                  try { await api.delete(`/rides/${id}`); navigate("/ride"); }
                  catch { alert("Cancel failed"); }
                }
              }}
              className="text-xs text-red-400 hover:text-red-300 transition-colors py-2 px-3 border border-red-500/30 rounded-lg"
            >Cancel ride</button>
          )}
          <button
            onClick={() => navigate("/ride")}
            className="text-xs text-gray-600 hover:text-white transition-colors py-2 px-3 border border-gray-600 rounded-lg"
          >{status === "completed" ? "Home" : "Back"}</button>
        </div>
      </div>

      {/* Map */}
      <div className="relative" style={{ height: 420 }}>
        <MapContainer
          center={pickupCoords ? [pickupCoords.lat, pickupCoords.lng] : [28.6139, 77.2090]}
          zoom={15}
          style={{ height: '100%', width: '100%' }}
          zoomControl={false}
          scrollWheelZoom={false}
          dragging={false}
        >
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            attribution="&copy; CARTO"
          />
          {pickupCoords && <MapCenterer coords={pickupCoords} />}

          {/* User marker */}
          {pickupCoords && (
            <Marker
              position={[pickupCoords.lat, pickupCoords.lng]}
              icon={userLocationIcon}
            />
          )}

          {/* Driver markers */}
          {driverPositions.map((pos, index) => (
            <Marker
              key={nearbyDrivers[index]?._id || `d-${index}`}
              position={[pos.lat, pos.lng]}
              icon={makeDriverIcon(rideType, index)}
              title={nearbyDrivers[index]?.name}
            />
          ))}
        </MapContainer>

        {/* Status pill */}
        <div className="absolute bottom-5 left-1/2 -translate-x-1/2 bg-[#111]/95 border border-[#2a2a2a] rounded-full px-5 py-2.5 flex items-center gap-2 z-[999] shadow-xl">
          <span className="w-2 h-2 bg-white rounded-full animate-pulse" />
          <span className="text-sm text-gray-300 whitespace-nowrap">
            {STATUS_LABELS[status] || status}
          </span>
        </div>

        {/* Nearby driver count */}
        {nearbyDrivers.length > 0 && status === "searching" && (
          <div className="absolute top-4 right-4 bg-[#111]/90 border border-[#333] rounded-xl px-3 py-2 z-[999]">
            <p className="text-xs text-gray-400">{nearbyDrivers.length} drivers nearby</p>
          </div>
        )}
      </div>

      {/* Ride details */}
      {ride && (
        <div className="bg-[#111] border-t border-[#222] px-6 py-5 space-y-4">
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
              <div className="w-10 h-10 rounded-full bg-[#1a1a1a] border border-[#333] flex items-center justify-center text-xl">
                {VEHICLE_ICONS[rideType] || '🚗'}
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium capitalize">{rideType} ride</p>
                <p className="text-xs text-gray-500 animate-pulse">Looking for nearby drivers...</p>
              </div>
              {ride.fare?.total ? <p className="text-lg font-medium">₹{ride.fare.total}</p> : null}
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