import { useState, useEffect, useRef } from "react";
import { useAuth } from "../context/AuthContext";
import { useNavigate } from "react-router-dom";
import api, { estimateRide } from "../services/api";
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const RIDE_TYPES = [
  { id: "bike", label: "Bike", icon: "🏍️", base: 20, perKm: 8 },
  { id: "auto", label: "Auto", icon: "🛺", base: 30, perKm: 10 },
  { id: "standard", label: "Car", icon: "🚗", base: 50, perKm: 12 },
  { id: "comfort", label: "Comfort", icon: "🚙", base: 80, perKm: 18 },
  { id: "black", label: "Black", icon: "⬛", base: 150, perKm: 28 },
  { id: "parcel", label: "Parcel", icon: "📦", base: 40, perKm: 15 },
];

const INDIA_BOUNDS = [[6.4627, 68.1097], [35.5133, 97.3953]];
const INDIA_CENTER = [20.5937, 78.9629];

function LocationSetter({ coords }) {
  const map = useMap();
  useEffect(() => {
    if (coords) map.setView([coords.lat, coords.lng], 14);
  }, [coords, map]);
  return null;
}

// Autocomplete input using Nominatim
function LocationInput({ value, onChange, onSelect, placeholder, dotStyle }) {
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const debounceRef = useRef(null);

  const handleChange = (e) => {
    const val = e.target.value;
    onChange(val);
    clearTimeout(debounceRef.current);
    if (val.length < 3) { setSuggestions([]); return; }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(val)}&format=json&addressdetails=1&limit=6&countrycodes=in`,
          { headers: { 'Accept-Language': 'en' } }
        );
        const data = await res.json();
        setSuggestions(data);
        setShowSuggestions(true);
      } catch { setSuggestions([]); }
    }, 400);
  };

  const handleSelect = (item) => {
    const label = item.display_name.split(",").slice(0, 3).join(", ");
    onChange(label);
    onSelect({ lat: parseFloat(item.lat), lng: parseFloat(item.lon), label });
    setSuggestions([]);
    setShowSuggestions(false);
  };

  return (
    <div className="relative">
      <span className={`absolute left-3 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full ${dotStyle}`}></span>
      <input
        value={value}
        onChange={handleChange}
        onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
        onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
        className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl pl-8 pr-4 py-3 text-sm text-white outline-none focus:border-[#555] transition-colors"
        placeholder={placeholder}
        autoComplete="off"
      />
      {showSuggestions && suggestions.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-[#111] border border-[#2a2a2a] rounded-xl overflow-hidden z-50 shadow-xl">
          {suggestions.map((item, i) => {
            const parts = item.display_name.split(",");
            const main = parts.slice(0, 2).join(",");
            const sub = parts.slice(2, 4).join(",");
            return (
              <button
                key={i}
                onMouseDown={() => handleSelect(item)}
                className="w-full text-left px-4 py-3 hover:bg-[#1a1a1a] transition-colors border-b border-[#1e1e1e] last:border-0"
              >
                <div className="text-sm text-white truncate">{main}</div>
                <div className="text-xs text-gray-500 truncate mt-0.5">{sub}</div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function RiderDashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [pickup, setPickup] = useState("");
  const [destination, setDestination] = useState("");
  const [pickupCoords, setPickupCoords] = useState(null);
  const [destCoords, setDestCoords] = useState(null);
  const [rideType, setRideType] = useState("standard");
  const [promoCode, setPromoCode] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash"); 
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [userCoords, setUserCoords] = useState(null);
  const [locationLabel, setLocationLabel] = useState("Detecting location...");
  const [estimate, setEstimate] = useState({ distance: 0, duration: 0, fare: { total: 0, baseFare: 0, distanceFare: 0 } });

  const selectedRide = RIDE_TYPES.find((r) => r.id === rideType);

  useEffect(() => {
    if (!navigator.geolocation) { setLocationLabel("Location unavailable"); return; }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        const coords = { lat, lng };
        setUserCoords(coords);
        setPickupCoords(coords);
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
            { headers: { 'Accept-Language': 'en' } }
          );
          const data = await res.json();
          const label = data.address?.suburb || data.address?.neighbourhood ||
            data.address?.city_district || data.address?.city || "Current location";
          setLocationLabel(label);
          setPickup(label);
        } catch {
          setLocationLabel("Current location");
          setPickup("Current location");
        }
      },
      () => {
        const fallback = { lat: 28.6139, lng: 77.2090 };
        setUserCoords(fallback);
        setPickupCoords(fallback);
        setLocationLabel("New Delhi");
        setPickup("New Delhi");
      }
    );
  }, []);

  const fetchEstimate = async () => {
    if (!pickupCoords || !destCoords) return;
    try {
      const { data } = await estimateRide(pickupCoords, destCoords, rideType, promoCode);
      setEstimate(data);
    } catch {
      setEstimate({ distance: 0, duration: 0, fare: { total: 0 } });
    }
  };

  useEffect(() => {
    const timer = setTimeout(fetchEstimate, 500);
    return () => clearTimeout(timer);
  }, [pickupCoords, destCoords, rideType, promoCode]);

  const handleBook = async () => {
    if (!pickup || !destination || estimate.distance === 0) { 
      setError("Please select pickup, destination, and wait for estimate"); 
      return; 
    }
    setError("");
    setLoading(true);
    try {
      const { data } = await api.post("/rides", {
        pickup: { address: pickup, coordinates: pickupCoords },
        destination: { address: destination, coordinates: destCoords },
        rideType,
        distance: estimate.distance,
        duration: estimate.duration,
        promoCode,
        payment: { method: paymentMethod },
      });
      navigate(`/ride/${data.ride._id}`);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to book ride");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white relative">
      {/* Map */}
      <div className="absolute inset-0 z-0">
        <MapContainer
          center={INDIA_CENTER}
          zoom={5}
          minZoom={5}
          maxZoom={18}
          maxBounds={INDIA_BOUNDS}
          maxBoundsViscosity={1.0}
          style={{ height: '100%', width: '100%' }}
          zoomControl={true}
          scrollWheelZoom={true}
          dragging={true}
        >
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            attribution='&copy; CARTO'
            bounds={INDIA_BOUNDS}
          />
          {userCoords && (
            <>
              <LocationSetter coords={userCoords} />
              <Marker position={[userCoords.lat, userCoords.lng]} />
            </>
          )}
          {destCoords && <Marker position={[destCoords.lat, destCoords.lng]} />}
        </MapContainer>
        <div className="absolute inset-0 bg-black opacity-40 pointer-events-none" />
      </div>

      {/* UI */}
      <div className="relative z-10">
        <div className="px-6 py-4 flex justify-between items-center bg-black bg-opacity-60 backdrop-blur-sm border-b border-[#1a1a1a]">
          <div>
            <h1 className="text-lg tracking-[0.2em] font-light">VELOUR</h1>
            <p className="text-xs text-gray-600 tracking-widest">RIDE</p>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-400">Hello, {user?.name?.split(" ")[0]}</span>
            <button onClick={logout} className="text-xs text-gray-600 hover:text-white transition-colors">Sign out</button>
          </div>
        </div>

        {userCoords && (
          <div className="flex justify-center mt-4">
            <div className="bg-black bg-opacity-70 border border-[#333] rounded-full px-4 py-1.5 flex items-center gap-2">
              <span className="w-2 h-2 bg-white rounded-full animate-pulse"></span>
              <span className="text-xs text-gray-300">{locationLabel}</span>
            </div>
          </div>
        )}

        <div className="max-w-md mx-auto px-6 py-6 space-y-4">
          <div className="bg-black bg-opacity-80 border border-[#222] rounded-2xl p-5 space-y-4 backdrop-blur-sm">
            <div>
              <label className="text-xs text-gray-500 tracking-widest block mb-2">PICKUP</label>
              <LocationInput
                value={pickup}
                onChange={setPickup}
                onSelect={(s) => { setPickupCoords({ lat: s.lat, lng: s.lng }); setPickup(s.label); setUserCoords({ lat: s.lat, lng: s.lng }); }}
                placeholder="Search pickup location..."
                dotStyle="bg-white"
              />
            </div>
            <div className="w-px h-4 bg-[#333] ml-3.5"></div>
            <div>
              <label className="text-xs text-gray-500 tracking-widests block mb-2">DESTINATION</label>
              <LocationInput
                value={destination}
                onChange={setDestination}
                onSelect={(s) => { setDestCoords({ lat: s.lat, lng: s.lng }); setDestination(s.label); }}
                placeholder="Search destination..."
                dotStyle="border border-gray-500"
              />
            </div>
          </div>

          <div>
            <p className="text-xs text-gray-500 tracking-widest mb-3">SELECT RIDE</p>
            <div className="grid grid-cols-3 gap-3">
              {RIDE_TYPES.map((r) => (
                <button key={r.id} onClick={() => setRideType(r.id)}
                  className={`bg-black bg-opacity-80 border rounded-xl p-3 text-center transition-colors ${rideType === r.id ? "border-white" : "border-[#222] hover:border-[#444]"}`}>
                  <div className="text-xl mb-1">{r.icon}</div>
                  <div className="text-xs font-medium text-white">{r.label}</div>
                  <div className="text-xs text-gray-500 mt-0.5">₹{r.base}+</div>
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Promo (FIRST10)"
              value={promoCode}
              onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
              className="flex-1 bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-[#555]"
            />
            <button onClick={fetchEstimate} className="bg-gray-700 px-4 py-3 rounded-xl text-sm hover:bg-gray-600 transition-colors">
              Apply
            </button>
          </div>

          <div className="bg-black bg-opacity-80 border border-[#222] rounded-2xl p-5 space-y-2 backdrop-blur-sm">
            {estimate.fare.promoDiscount > 0 && (
              <div className="flex justify-between text-sm text-green-400"><span>Promo discount</span><span>-₹{estimate.fare.promoDiscount}</span></div>
            )}
            {estimate.distance > 0 && (
              <div className="flex justify-between text-xs text-gray-500 mt-2">
                <span>ETA {estimate.duration} min</span>
                <span className="font-medium">₹{estimate.fare.total.toFixed(0)}</span>
              </div>
            )}
            {estimate.distance === 0 && (
              <div className="flex justify-between text-xs text-gray-500 mt-2">
                <span>Enter locations for estimate</span>
                <span>--</span>
              </div>
            )}
            <div className="flex justify-between text-sm text-gray-400"><span>Base fare</span><span>₹{estimate.fare.baseFare}</span></div>
            <div className="flex justify-between text-sm text-gray-400"><span>Distance ({estimate.distance} km)</span><span>₹{estimate.fare.distanceFare}</span></div>
            <div className="flex justify-between text-sm text-gray-400"><span>Est. time ({estimate.duration} min)</span><span>₹0</span></div>
            <div className="flex justify-between font-medium text-white pt-3 border-t border-[#222] text-base"><span>Total estimate</span><span>₹{estimate.fare.total}</span></div>
          </div>

          {error && <p className="text-red-400 text-sm text-center">{error}</p>}

          <div className="space-y-3">
            <select 
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-[#555]"
            >
              <option value="cash">Cash</option>
              <option value="card">Card/UPI</option>
              <option value="wallet">Wallet</option>
            </select>
            <button onClick={handleBook} disabled={loading}
              className="w-full bg-white text-black rounded-xl py-4 font-medium tracking-wide hover:bg-gray-100 transition-colors disabled:opacity-50">
              {loading ? "Booking..." : `Request ride (₹${estimate.fare.total})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}