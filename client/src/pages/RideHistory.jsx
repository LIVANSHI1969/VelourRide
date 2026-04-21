import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';

export default function RideHistory() {
  const { user } = useAuth();
  const [rides, setRides] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const { data } = await api.get('/rides/history');
        setRides(data.rides);
      } catch (err) {
        console.error('Failed to fetch history');
      } finally {
        setLoading(false);
      }
    };
    fetchHistory();
  }, []);

  if (loading) return <div className="text-center py-20 text-gray-500">Loading...</div>;

  return (
    <div className="min-h-screen bg-black text-white p-6">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-light tracking-wide mb-8">Ride History</h1>
        <div className="space-y-4">
          {rides.length === 0 ? (
            <p className="text-gray-500 text-center py-20">No rides yet</p>
          ) : (
            rides.map((ride) => (
              <div key={ride._id} className="bg-[#111] border border-[#222] rounded-2xl p-6 space-y-3">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-sm text-gray-400 capitalize">{ride.status}</p>
                    <p className="text-lg font-medium">{ride.rideType}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold">₹{ride.fare.total}</p>
                    <p className="text-sm text-gray-400">{ride.distance} km · {ride.duration} min</p>
                  </div>
                </div>
                <div className="flex gap-4 text-sm">
                  <div>
                    <p className="text-gray-500">Pickup</p>
                    <p>{ride.pickup.address}</p>
                  </div>
                  <div className="text-gray-500">→</div>
                  <div>
                    <p className="text-gray-500">Drop-off</p>
                    <p>{ride.destination.address}</p>
                  </div>
                </div>
                {ride.driver && (
                  <div className="flex items-center gap-3 pt-3 border-t border-[#222]">
                    <div className="w-10 h-10 bg-gray-600 rounded-full" />
                    <div>
                      <p className="font-medium">{ride.driver.name}</p>
                      <p className="text-sm text-gray-500">★ {ride.driver.rating || 4.8}</p>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
