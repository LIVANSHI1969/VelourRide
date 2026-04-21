import { useState, useEffect } from "react";
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

// Scooty icon for drivers
const scootyIcon = new L.Icon({
  iconUrl: 'data:image/svg+xml;base64,' + btoa(`
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="10" fill="#10B981" stroke="#065F46" stroke-width="2"/>
      <path d="M8 14l4-4 4 4" stroke="#065F46" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="10" cy="16" r="1.5" fill="#065F46"/>
      <circle cx="14" cy="16" r="1.5" fill="#065F46"/>
    </svg>
  `),
  iconSize: [24, 24],
  iconAnchor: [12, 12],
  popupAnchor: [0, -12],
});

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
  const [nearbyDrivers, setNearbyDrivers] = useState([]);

  useEffect(() => {
    const fetchRide = async () => {
      try {
        const { data } = await api.get(`/rides/${id}`);
        setRide(data.ride);
        setStatus(data.ride.status);

        // Fetch nearby drivers
        if (data.ride.pickup?.coordinates) {
          const { data: driversData } = await api.get('/drivers/nearby', {
            params: {
              lat: data.ride.pickup.coordinates.lat,
              lng: data.ride.pickup.coordinates.lng,
              radius: 5,
              rideType: data.ride.rideType
            }
          });
          setNearbyDrivers(driversData.drivers || []);
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

      {/* Map */}
      <div className="flex-1 relative">
        {ride ? (
          <MapContainer
            center={ride.pickup?.coordinates ? [ride.pickup.coordinates.lat, ride.pickup.coordinates.lng] : [28.6139, 77.2090]}
            zoom={15}
            style={{ height: '400px', width: '100%' }}
            zoomControl={false}
            scrollWheelZoom={false}
            dragging={false}
          >
            <TileLayer
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
              attribution='&copy; CARTO'
            />
            {/* Pickup location */}
            {ride.pickup?.coordinates && (
              <Marker position={[ride.pickup.coordinates.lat, ride.pickup.coordinates.lng]} />
            )}
            {/* Nearby drivers with scooty icons */}
            {nearbyDrivers.map((driver, index) => (
              driver.location?.coordinates && (
                <Marker
                  key={`driver-${index}`}
                  position={[driver.location.coordinates[1], driver.location.coordinates[0]]}
                  icon={scootyIcon}
                  title={driver.name}
                />
              )
            ))}
          </MapContainer>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-500">
            {ride ? 'No location data available' : 'Loading ride details...'}
          </div>
        )}

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