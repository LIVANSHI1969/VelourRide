import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { io } from "socket.io-client";
import api from "../services/api";
import { MapContainer, TileLayer, Marker, Polyline, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useAuth } from "../context/AuthContext";
import VehicleIcon from "../components/VehicleIcon";

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

const makePinIcon = (color) =>
  L.divIcon({
    className: "vr-wrap",
    html: `<div style="width:16px;height:16px;border-radius:50%;background:${color};
      border:2px solid #fff;box-shadow:0 0 0 2px ${color}33,0 6px 14px rgba(0,0,0,.35);"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });

const PICKUP_BLUE_ICON = makePinIcon("#3B82F6");
const PICKUP_GREEN_ICON = makePinIcon("#22C55E");
const DEST_RED_ICON = makePinIcon("#EF4444");

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
  requested:  "Driver is arriving in a few minutes",
  searching:  "Driver is arriving in a few minutes",
  accepted:   "Driver is arriving in a few minutes",
  arriving:   "Driver is arriving in a few minutes",
  started:    "Ride started",
  inProgress: "Ride in progress",
  completed:  "Ride completed ✓",
  cancelled:  "Ride Cancelled",
};

const lerp = (a, b, t) => a + (b - a) * t;
const toRad = (deg) => (deg * Math.PI) / 180;
const distanceKm = (from, to) => {
  if (!from || !to) return null;
  const R = 6371;
  const dLat = toRad(to.lat - from.lat);
  const dLng = toRad(to.lng - from.lng);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(from.lat)) * Math.cos(toRad(to.lat)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};
const distanceMeters = (from, to) => {
  const dKm = distanceKm(from, to);
  return typeof dKm === "number" ? dKm * 1000 : null;
};
const ensureDriverStartsAway = (driverPoint, riderPoint) => {
  if (!driverPoint || !riderPoint) return driverPoint;
  const gap = distanceKm(driverPoint, riderPoint);
  if (typeof gap !== "number" || gap >= 0.8) return driverPoint;
  // If too close (or same spot), move driver back so approach animation is visible.
  return { lat: riderPoint.lat + 0.045, lng: riderPoint.lng + 0.055 };
};

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

const CANCEL_REASONS = ["Driver late", "Changed plan", "Emergency"];

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
  const [rideStatus,   setRideStatus]   = useState("searching");
  const [userCoords,   setUserCoords]   = useState(null);
  const [driver,       setDriver]       = useState(null);
  const [driverPos,    setDriverPos]    = useState(null);
  const [routePoints,  setRoutePoints]  = useState([]);
  const [routeIdx,     setRouteIdx]     = useState(0);
  const [traveledRoute,setTraveledRoute]= useState([]);
  const [aheadRoute,   setAheadRoute]   = useState([]);
  const [eta,          setEta]          = useState(null);
  const [liveTracking, setLiveTracking] = useState(false);
  const [ridePhase,    setRidePhase]    = useState("on_the_way");
  const arrivalTimerRef = useRef(null);

  // Chat
  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input,    setInput]    = useState("");
  const [unread,   setUnread]   = useState(0);
  const chatEndRef = useRef(null);
  const [rating, setRating] = useState(5);
  const [feedback, setFeedback] = useState("");
  const [ratingDone, setRatingDone] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelError, setCancelError] = useState("");
  const [cancelReason, setCancelReason] = useState("Driver late");
  const [showCancelOptions, setShowCancelOptions] = useState(false);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState("cash");
  const [isPaying, setIsPaying] = useState(false);
  const [paymentSuccess, setPaymentSuccess] = useState("");
  const isCancelledFlowRef = useRef(false);

  const stopTracking = () => {
    setLiveTracking(false);
    setRoutePoints([]);
    setTraveledRoute([]);
    setAheadRoute([]);
    setEta(null);
    setDriverPos(null);
    setRidePhase("on_the_way");
    if (arrivalTimerRef.current) {
      clearTimeout(arrivalTimerRef.current);
      arrivalTimerRef.current = null;
    }
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
  };

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
      .then(({ data }) => {
        if (isCancelledFlowRef.current) return;
        if (data.ride?.status === "cancelled") {
          setRide(data.ride);
          setStatus("cancelled");
          stopTracking();
          return;
        }
        setRide(data.ride);
        setStatus(data.ride.status);
        if (Array.isArray(data.ride.chatMessages) && data.ride.chatMessages.length) {
          setMessages(
            data.ride.chatMessages.map((m) => ({
              message: m.message,
              senderName: m.senderName,
              senderRole: m.senderRole,
              timestamp: new Date(m.timestamp).getTime(),
            }))
          );
        }
      })
      .catch(console.error);
  }, [id, navigate]);

  // ── Socket setup — only once ──────────────────────────────────────────────
  useEffect(() => {
    const socket = io(import.meta.env.VITE_SOCKET_URL || "http://localhost:5000");
    socketRef.current = socket;

    socket.emit("joinRide", id);
    if (user?.id) socket.emit("joinUser", user.id);

    socket.on("rideStatusUpdate", ({ status: s, ride: updatedRide }) => {
      if (isCancelledFlowRef.current) return;
      if (s === "cancelled") {
        if (updatedRide) setRide(updatedRide);
        setStatus("cancelled");
        stopTracking();
        return;
      }
      setStatus(s);
      if (updatedRide) setRide(updatedRide);
      if (updatedRide?.status === "completed" && updatedRide?.rating?.riderRating) setRatingDone(true);
      if (s === "completed") setTimeout(() => navigate("/ride"), 12000);
    });

    socket.on("rideAccepted", () => setStatus("accepted"));

    // Use chatOpenRef (not chatOpen state) so we always see current value
    socket.on("chatMessage", (msg) => {
      // Only add if it came from the OTHER side (driver)
      // Our own messages are added locally in sendMessage()
      if (msg.senderRole !== "rider") {
        setMessages(prev => [...prev, msg]);
        if (!chatOpenRef.current) setUnread(u => u + 1);
      }
    });

    socket.on("driverMoved", ({ lat, lng }) => {
      if (typeof lat !== "number" || typeof lng !== "number") return;
      setLiveTracking(true);
      setDriverPos({ lat, lng });
    });

    socket.on("paymentUpdated", ({ paymentStatus }) => {
      setRide((prev) =>
        prev ? { ...prev, payment: { ...(prev.payment || {}), status: paymentStatus } } : prev
      );
    });

    return () => { socket.disconnect(); socketRef.current = null; };
  }, [id, navigate, user?.id]);

  // Clear unread + scroll when chat opens
  useEffect(() => {
    if (chatOpen) { setUnread(0); chatEndRef.current?.scrollIntoView({ behavior:"smooth" }); }
  }, [chatOpen]);

  useEffect(() => {
    setRideStatus(status);
    if (status !== "completed") {
      setPaymentSuccess("");
    }
  }, [status]);

  // Auto-scroll on new message
  useEffect(() => {
    if (chatOpen) chatEndRef.current?.scrollIntoView({ behavior:"smooth" });
  }, [messages]);

  const sendMessage = (text) => {
    const msg = (text || input).trim();
    if (!msg || !socketRef.current) return;

    // Add our own message locally RIGHT NOW (right side, no server echo needed)
    setMessages(prev => [...prev, {
      message:    msg,
      senderName: user?.name || "Rider",
      senderRole: "rider",
      timestamp:  Date.now(),
    }]);

    socketRef.current.emit("chatMessage", {
      rideId: id, message: msg,
      senderName: user?.name || "Rider", senderRole: "rider", senderId: user?.id,
    });
    if (!text) setInput("");
  };

  const submitRating = async () => {
    try {
      await api.post(`/rides/${id}/rating`, {
        target: "driver",
        rating,
        feedback,
      });
      setRatingDone(true);
    } catch {
      alert("Could not submit rating");
    }
  };

  const handlePayNow = async () => {
    if (isPaying || rideStatus !== "completed") return;
    setIsPaying(true);
    setPaymentSuccess("");
    try {
      await api.put(`/rides/${id}/payment`, {
        status: "paid",
        transactionId:
          selectedPaymentMethod === "cash" ? undefined : `${selectedPaymentMethod}_${Date.now()}`,
      });
      setRide((prev) =>
        prev
          ? {
              ...prev,
              payment: {
                ...(prev.payment || {}),
                method: selectedPaymentMethod,
                status: "paid",
              },
            }
          : prev
      );
      setPaymentSuccess(`Payment successful via ${selectedPaymentMethod.toUpperCase()}.`);
    } catch (err) {
      alert(err?.response?.data?.message || "Payment failed. Please try again.");
    } finally {
      setIsPaying(false);
    }
  };

  const handleCancelRide = async () => {
    if (isCancelling) return;
    const requiresExtraConfirm = ["arriving", "inProgress"].includes(status);
    const msg = requiresExtraConfirm
      ? "Driver is already near/arrived. Are you sure you want to cancel?"
      : "Cancel this ride?";
    if (!confirm(msg)) return;

    setIsCancelling(true);
    setCancelError("");
    try {
      await api.put(`/rides/${id}/cancel`, { reason: cancelReason });
      isCancelledFlowRef.current = true;
      setStatus("cancelled");
      setRide((prev) =>
        prev
          ? { ...prev, status: "cancelled", cancellation: { ...(prev.cancellation || {}), reason: cancelReason } }
          : prev
      );
      stopTracking();
      setShowCancelOptions(false);
      setIsCancelling(false);
    } catch (err) {
      setCancelError(err?.response?.data?.message || "Failed to cancel ride. Please try again.");
      setIsCancelling(false);
    }
  };

  // ── Pick driver + fetch route ─────────────────────────────────────────────
  useEffect(() => {
    if (status === "cancelled") return;
    if (ride?.driver?.location?.coordinates?.length === 2) {
      const [lng, lat] = ride.driver.location.coordinates;
      setDriverPos({ lat, lng });
      setDriver({
        name: ride.driver.name,
        rideType: ride.driver.vehicle?.type || ride?.rideType,
        rating: ride.driver.rating,
        vehicle: ride.driver.vehicle,
        lat,
        lng,
      });
      return;
    }
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
        // Keep fallback driver visibly far so rider sees approach clearly.
        startPos   = { lat: center.lat + 0.05, lng: center.lng + 0.06 };
        driverInfo = { name: "Your Driver", rideType: ride.rideType, rating: 4.9 };
      }
      startPos = ensureDriverStartsAway(startPos, center);

      setDriver({ ...driverInfo, ...startPos });
      setDriverPos({ ...startPos });
      setRidePhase("on_the_way");
      setRouteIdx(0);

      const pickupPoint = center;
      const road = await fetchRoadRoute(startPos, pickupPoint);

      if (road && road.length > 1) {
        setRoutePoints(road);
        setAheadRoute(road);
        setTraveledRoute([startPos]);
      } else {
        const steps = 40;
        const straight = Array.from({ length: steps + 1 }, (_, i) => ({
          lat: lerp(startPos.lat, pickupPoint.lat, i / steps),
          lng: lerp(startPos.lng, pickupPoint.lng, i / steps),
        }));
        setRoutePoints(straight);
        setAheadRoute(straight);
        setTraveledRoute([startPos]);
      }
    };

    pick();
  }, [ride, userCoords]);

  // ── Ride phase machine (on_the_way -> arrived -> in_progress -> completed) ──
  useEffect(() => {
    if (status === "cancelled" || status === "completed") return;
    const pickupPoint = ride?.pickup?.coordinates || userCoords;
    if (!driverPos || !pickupPoint) return;
    const nearPickup = distanceMeters(driverPos, pickupPoint);
    if (ridePhase === "on_the_way" && typeof nearPickup === "number" && nearPickup <= 50) {
      setRidePhase("arrived");
    }
  }, [driverPos, ride?.pickup?.coordinates, userCoords, ridePhase, status]);

  useEffect(() => {
    if (ridePhase !== "arrived") return;
    if (arrivalTimerRef.current) clearTimeout(arrivalTimerRef.current);
    arrivalTimerRef.current = setTimeout(async () => {
      const pickupPoint = ride?.pickup?.coordinates || userCoords;
      const destinationPoint = ride?.destination?.coordinates;
      if (!pickupPoint || !destinationPoint) return;
      setRidePhase("in_progress");
      setRouteIdx(0);
      const road = await fetchRoadRoute(pickupPoint, destinationPoint);
      if (road && road.length > 1) {
        setRoutePoints(road);
        setAheadRoute(road);
        setTraveledRoute([pickupPoint]);
      } else {
        const steps = 52;
        const straight = Array.from({ length: steps + 1 }, (_, i) => ({
          lat: lerp(pickupPoint.lat, destinationPoint.lat, i / steps),
          lng: lerp(pickupPoint.lng, destinationPoint.lng, i / steps),
        }));
        setRoutePoints(straight);
        setAheadRoute(straight);
        setTraveledRoute([pickupPoint]);
      }
    }, 2000);

    return () => {
      if (arrivalTimerRef.current) {
        clearTimeout(arrivalTimerRef.current);
        arrivalTimerRef.current = null;
      }
    };
  }, [ridePhase, ride?.pickup?.coordinates, ride?.destination?.coordinates, userCoords]);

  useEffect(() => {
    if (status === "cancelled") return;
    if (!driverPos || ridePhase !== "in_progress") return;
    const destinationPoint = ride?.destination?.coordinates;
    if (!destinationPoint) return;
    const nearDestination = distanceMeters(driverPos, destinationPoint);
    if (typeof nearDestination === "number" && nearDestination <= 50) {
      setRidePhase("completed");
    }
  }, [driverPos, ride?.destination?.coordinates, ridePhase, status]);

  useEffect(() => {
    if (status === "completed") setRidePhase("completed");
  }, [status]);

  // ── Animate driver along route (fast + smooth stepping) ───────────────────
  useEffect(() => {
    if (status === "cancelled") return;
    if (ridePhase === "completed") return;
    if (liveTracking) return;
    if (!routePoints.length) return;
    const SPEED = 1, TICK = 300;
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
  }, [routePoints, liveTracking, ridePhase, status]);

  const rideType  = ride?.rideType || "standard";
  const vehicle   = VEHICLE[rideType] || VEHICLE.standard;
  const mapCenter = userCoords || ride?.pickup?.coordinates || { lat:28.6139, lng:77.209 };
  const isDriverAssigned = Boolean(ride?.driver) || ["accepted", "arriving", "inProgress"].includes(status);
  const driverDisplayName = ride?.driver?.name || driver?.name || (isDriverAssigned ? "Driver is arriving in a few minutes" : "Finding driver...");
  const riderTargetPoint = userCoords || ride?.pickup?.coordinates;
  const pickupPoint = ride?.pickup?.coordinates || userCoords;
  const destinationPoint = ride?.destination?.coordinates;
  const driverDistanceKm = distanceKm(driverPos, riderTargetPoint);
  const destinationDistanceKm = distanceKm(driverPos, destinationPoint);
  const rideStatusLabel = ridePhase === "completed"
    ? "completed"
    : ridePhase === "in_progress"
      ? "in_progress"
      : ridePhase === "arrived"
        ? "arrived"
        : "on_the_way";
  const isDriverFarAway = typeof driverDistanceKm === "number" && driverDistanceKm > 2;
  const isActiveRide = ["requested", "searching", "accepted", "arriving", "started", "inProgress"].includes(status);
  const arrivalMessage =
    ridePhase === "completed"
      ? "Ride completed"
      : ridePhase === "in_progress"
        ? (eta ? `Heading to destination · ${eta} minute${eta > 1 ? "s" : ""}` : "Ride in progress")
        : ridePhase === "arrived"
          ? "Driver has arrived"
          : (eta && isActiveRide
            ? `Driver arriving in ${eta} minute${eta > 1 ? "s" : ""}`
            : "Driver is arriving in a few minutes");

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">

      <button
        onClick={() => setShowCancelOptions((prev) => !prev)}
        disabled={isCancelling || ["completed", "cancelled"].includes(status)}
        className="fixed top-3 right-3 z-[1200] text-xs text-red-300 hover:text-red-200 py-2 px-3 border border-red-500/40 rounded-lg bg-[#111]/95 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {showCancelOptions ? "Close cancel" : "Cancel ride"}
      </button>
      {showCancelOptions && !["completed", "cancelled"].includes(status) && (
        <div className="fixed top-14 right-3 z-[1200] bg-[#111]/95 border border-[#2a2a2a] rounded-lg p-2">
          <p className="text-[10px] text-gray-500 mb-1 tracking-wider">CANCEL REASON</p>
          <select
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            className="bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1 text-[11px] text-white outline-none"
          >
            {CANCEL_REASONS.map((reason) => (
              <option key={reason} value={reason}>{reason}</option>
            ))}
          </select>
          <button
            onClick={handleCancelRide}
            disabled={isCancelling}
            className="mt-2 w-full py-1.5 rounded border border-red-500/40 text-red-300 text-[11px] hover:text-red-200 disabled:opacity-50"
          >
            {isCancelling ? "Cancelling..." : "Confirm cancel"}
          </button>
        </div>
      )}

      {/* Header */}
      <div className="border-b border-[#1a1a1a] px-6 py-4 pr-28 flex justify-between items-center shrink-0">
        <div>
          <h1 className="text-lg tracking-[0.2em] font-light">VELOUR</h1>
          <p className="text-xs text-gray-600 tracking-widest">RIDE</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => navigate("/ride")}
            className="text-xs text-gray-600 hover:text-white py-2 px-3 border border-gray-600 rounded-lg transition-colors">
            {status === "completed" ? "Home" : "Back"}
          </button>
        </div>
      </div>
      {cancelError && (
        <div className="mx-4 mt-3 px-3 py-2 rounded-lg border border-red-500/30 bg-red-500/10 text-xs text-red-300">
          {cancelError}
        </div>
      )}

      {status === "cancelled" && (
        <div className="flex-1 flex items-center justify-center px-6">
          <div className="w-full max-w-md bg-[#111] border border-red-500/30 rounded-2xl p-6 text-center">
            <p className="text-lg font-semibold text-red-300">Ride Cancelled</p>
            <p className="text-sm text-gray-400 mt-2">Your ride has been cancelled successfully.</p>
            <button
              onClick={() => navigate("/ride")}
              className="mt-5 w-full py-3 rounded-xl bg-white text-black text-sm font-medium"
            >
              Back to dashboard
            </button>
          </div>
        </div>
      )}

      {/* Map */}
      {status !== "cancelled" && (
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
          {driverPos && pickupPoint && ridePhase !== "in_progress" && ridePhase !== "completed" && (
            <Polyline
              positions={[[driverPos.lat, driverPos.lng], [pickupPoint.lat, pickupPoint.lng]]}
              pathOptions={{ color: "#22d3ee", weight: 3, opacity: 0.9 }}
            />
          )}
          {driverPos && destinationPoint && ridePhase === "in_progress" && (
            <Polyline
              positions={[[driverPos.lat, driverPos.lng], [destinationPoint.lat, destinationPoint.lng]]}
              pathOptions={{ color: "#EF4444", weight: 3, opacity: 0.9 }}
            />
          )}
          {userCoords && <Marker position={[userCoords.lat, userCoords.lng]} icon={USER_ICON} />}
          {pickupPoint && (
            <Marker
              position={[pickupPoint.lat, pickupPoint.lng]}
              icon={ridePhase === "arrived" || ridePhase === "in_progress" || ridePhase === "completed" ? PICKUP_GREEN_ICON : PICKUP_BLUE_ICON}
            />
          )}
          {destinationPoint && (
            <Marker
              position={[destinationPoint.lat, destinationPoint.lng]}
              icon={DEST_RED_ICON}
            />
          )}
          {driverPos && <Marker position={[driverPos.lat, driverPos.lng]}
            icon={makeDriverIcon(driver?.rideType || rideType)} title={driver?.name} />}
        </MapContainer>

        {/* Status + ETA */}
        <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-[999]
          bg-[#111]/95 border border-[#2a2a2a] rounded-full px-5 py-2.5
          flex items-center gap-2.5 shadow-xl pointer-events-none">
          <span className="w-2 h-2 rounded-full animate-pulse shrink-0" style={{ background: vehicle.color }} />
          <span className="text-sm text-gray-300 whitespace-nowrap">{isActiveRide ? arrivalMessage : (STATUS_LABELS[status] || status)}</span>
          {eta && (ridePhase === "on_the_way" || ridePhase === "in_progress") && (
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
              style={{ background: vehicle.color+"33", color: vehicle.color }}>~{eta} min</span>
          )}
        </div>

        {isDriverAssigned && typeof driverDistanceKm === "number" && (
          <div className="absolute top-4 right-4 z-[999] bg-[#111]/90 border border-[#333] rounded-xl px-3 py-2 pointer-events-none">
            <p className="text-[11px] text-gray-300">
              {ridePhase === "completed"
                ? "Ride completed"
                : ridePhase === "arrived"
                  ? "Driver has arrived"
                  : ridePhase === "in_progress"
                    ? "Heading to destination"
                    : (isDriverFarAway ? "Driver is far away" : "Driver assigned")}
            </p>
            <p className="text-xs font-semibold" style={{ color: vehicle.color }}>
              {ridePhase === "in_progress" && typeof destinationDistanceKm === "number"
                ? `${destinationDistanceKm.toFixed(1)} km to destination`
                : `${driverDistanceKm.toFixed(1)} km away`}
            </p>
          </div>
        )}

        {/* Driver tag */}
        {driver && (
          <div className="absolute top-4 left-4 z-[999] bg-[#111]/90 border border-[#333] rounded-xl px-3 py-2 pointer-events-none">
            <p className="text-xs font-semibold text-white">{driver.name}</p>
            <p className="text-[10px] mt-0.5" style={{ color: vehicle.color }}>
              <span className="inline-flex items-center gap-1">
                <VehicleIcon vehicleType={rideType} size={12} color={vehicle.color} />
                {vehicle.label}{driver.rating ? ` · ★${driver.rating}` : ""}
              </span>
            </p>
          </div>
        )}
      </div>
      )}

      {/* ── Driver card + Chat — always visible ── */}
      {status !== "cancelled" && (
      <div className="flex flex-col flex-1 bg-[#0f0f0f]">

        {/* Driver card */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[#1e1e1e]">
          <div className="w-12 h-12 rounded-full shrink-0 flex items-center justify-center text-2xl border-2"
            style={{ background:"#1a1a1a", borderColor: vehicle.color+"66" }}>
            <VehicleIcon vehicleType={rideType} size={22} color={vehicle.color} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-white truncate">{driverDisplayName}</p>
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
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#1d1d1d] border border-[#2a2a2a] text-gray-300 uppercase">
                {rideStatusLabel}
              </span>
              {(ridePhase === "on_the_way" || ridePhase === "in_progress") && typeof eta === "number" && (
                <span className="text-[10px] text-gray-400">ETA {eta} min</span>
              )}
            </div>
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

        {rideStatus === "completed" && (
          <div className="px-4 py-3 border-b border-[#1e1e1e] space-y-2">
            <p className="text-xs text-gray-400 tracking-wider">PAYMENT</p>
            {ride?.payment?.status === "paid" || paymentSuccess ? (
              <p className="text-xs text-green-400">
                {paymentSuccess || "Payment completed successfully."}
              </p>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-2">
                  {["cash", "upi", "card"].map((method) => (
                    <button
                      key={method}
                      onClick={() => setSelectedPaymentMethod(method)}
                      className={`py-2 rounded-xl text-xs border transition-colors ${
                        selectedPaymentMethod === method
                          ? "bg-white text-black border-white"
                          : "bg-[#1a1a1a] text-gray-300 border-[#2a2a2a] hover:border-[#444]"
                      }`}
                    >
                      {method.toUpperCase()}
                    </button>
                  ))}
                </div>
                <button
                  onClick={handlePayNow}
                  disabled={isPaying}
                  className="w-full py-2 rounded-xl bg-white text-black text-xs font-medium disabled:opacity-50"
                >
                  {isPaying ? "Processing..." : "Pay Now"}
                </button>
              </>
            )}
          </div>
        )}

        {rideStatus === "completed" && (
          <div className="px-4 py-3 border-b border-[#1e1e1e] space-y-2">
            <p className="text-xs text-gray-400 tracking-wider">RATE YOUR DRIVER</p>
            {ratingDone ? (
              <p className="text-xs text-green-400">Thanks! Your feedback was submitted.</p>
            ) : (
              <>
                <div className="flex gap-2">
                  {[1, 2, 3, 4, 5].map((r) => (
                    <button
                      key={r}
                      onClick={() => setRating(r)}
                      className={`w-8 h-8 rounded-full text-xs ${rating >= r ? "bg-white text-black" : "bg-[#1a1a1a] text-gray-400 border border-[#2a2a2a]"}`}
                    >
                      ★
                    </button>
                  ))}
                </div>
                <textarea
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  placeholder="Share feedback (optional)"
                  className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl px-3 py-2 text-xs text-white outline-none"
                  rows={2}
                />
                <button onClick={submitRating} className="w-full py-2 rounded-xl bg-white text-black text-xs font-medium">
                  Submit rating
                </button>
              </>
            )}
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
      )}
    </div>
  );
}