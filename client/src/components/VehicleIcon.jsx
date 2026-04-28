import { FaBox, FaCarSide, FaMotorcycle, FaShuttleVan, FaTruckPickup } from "react-icons/fa";
import { RiVipCrown2Fill } from "react-icons/ri";

const VEHICLE_ICON_MAP = {
  bike: FaMotorcycle,
  car: FaCarSide,
  auto: FaShuttleVan,
  parcel: FaBox,
  standard: FaTruckPickup,
  premium: RiVipCrown2Fill,
  comfort: FaCarSide,
  black: RiVipCrown2Fill,
};

const DEFAULT_COLOR = "#9CA3AF";

export default function VehicleIcon({ vehicleType = "standard", size = 18, color = DEFAULT_COLOR, className = "" }) {
  const IconComponent = VEHICLE_ICON_MAP[vehicleType] || VEHICLE_ICON_MAP.standard;
  return <IconComponent size={size} color={color} className={className} aria-hidden="true" />;
}

export { VEHICLE_ICON_MAP };
