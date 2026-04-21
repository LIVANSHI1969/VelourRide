import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';

export default function Profile() {
  const { user, logout } = useAuth();
  const [profile, setProfile] = useState(user);
  const [loading, setLoading] = useState(false);

  const updateProfile = async (form) => {
    setLoading(true);
    try {
      const { data } = await api.put('/users/profile', form);
      setProfile(data);
    } catch (err) {
      alert('Update failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white p-6">
      <h1 className="text-2xl font-bold mb-6">Profile</h1>
      <div className="bg-[#111] rounded-2xl p-6 space-y-4">
        <div>
          <label className="text-sm text-gray-400 mb-2 block">Name</label>
          <input className="w-full bg-[#1a1a1a] border border-[#333] rounded-xl px-4 py-3" value={profile.name} />
        </div>
        <div>
          <label className="text-sm text-gray-400 mb-2 block">Phone</label>
          <input className="w-full bg-[#1a1a1a] border border-[#333] rounded-xl px-4 py-3" value={profile.phone || ''} />
        </div>
        {profile.role === 'driver' && (
          <div>
            <label className="text-sm text-gray-400 mb-2 block">Vehicle Model</label>
            <input className="w-full bg-[#1a1a1a] border border-[#333] rounded-xl px-4 py-3" value={profile.vehicle?.model || ''} />
          </div>
        )}
        <button disabled={loading} className="w-full bg-white text-black py-3 rounded-xl font-medium">
          {loading ? 'Saving...' : 'Update Profile'}
        </button>
        <button onClick={logout} className="w-full border border-red-500 text-red-400 py-3 rounded-xl hover:bg-red-500/20">
          Log out
        </button>
      </div>
    </div>
  );
}
