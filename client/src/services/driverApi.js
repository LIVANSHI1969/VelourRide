import api from "./api";

export const fetchDriverDashboard = () => api.get("/drivers/dashboard");
export const fetchRequestedRides = () => api.get("/rides", { params: { status: "requested" } });
export const acceptRideRequest = (rideId) => api.put(`/rides/${rideId}/accept`);
export const rejectRideRequest = (rideId) => api.put(`/rides/${rideId}/reject`);
export const updateRideStatus = (rideId, status) => api.put(`/rides/${rideId}/status`, { status });
export const fetchNavigationRoute = (from, to) => api.post("/rides/navigation", { from, to });
export const toggleDriverOnline = () => api.put("/drivers/toggle");
export const updateDriverLocation = (lat, lng) => api.put("/drivers/location", { lat, lng });
