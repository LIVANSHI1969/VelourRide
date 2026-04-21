# VelourRide Enhancement TODO

## Approved Plan Breakdown (Pricing + Uber/Ola Features)

### Phase 1: Fix Realistic Pricing (per km, INR)
1. ✅ **Plan approved by user**
2. Update server/controllers/rideController.js: FARE_RATES to km/INR, add haversine distance calc for estimate endpoint
3. Update server/models/Ride.js: distance comment to km
4. Add server/routes/rideRoutes.js: POST /estimate endpoint
5. Update client/src/services/api.js: add estimateRide func
6. Update client/src/pages/RiderDashboard.jsx: call estimate API real-time, use km/₹ consistent, remove hardcoded

### Phase 2: Core Uber/Ola Features
7. Add promo codes: Ride model + controller discount logic
8. Add ride history page: client/src/pages/RideHistory.jsx + App.jsx route + use history endpoint
9. Add cancel ride: endpoint + UI in RideTracking.jsx
10. Payment stub: Ride model field + controller + UI

### Phase 3: Advanced
11. Driver earnings in DriverDashboard.jsx
12. Schedule rides field/endpoint
13. Post-ride ratings

### Phase 4: Test & Complete
- Test booking with real estimate/pricing
- Full end-to-end flow
- attempt_completion

**Current Progress: ✅ Phase 3 Step 11 Complete (Driver earnings). Features advanced! Run server/client to test.
