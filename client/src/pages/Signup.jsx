import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Signup() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "rider",
    phone: "",
    vehicle: { model: "", plate: "", type: "standard" },
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const payload = { ...form };
      if (form.role !== "driver") delete payload.vehicle;
      const user = await register(payload);
      navigate(user.role === "driver" ? "/driver" : "/ride");
    } catch (err) {
      setError(err.response?.data?.message || "Signup failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="mb-10 text-center">
          <h1 className="text-3xl font-light tracking-[0.3em] text-white">VELOUR</h1>
          <p className="text-xs tracking-[0.2em] text-gray-600 mt-1">RIDE</p>
        </div>

        {/* Card */}
        <div className="bg-[#111] border border-[#222] rounded-2xl p-8">
          <h2 className="text-lg font-medium text-white mb-6">Create account</h2>

          {error && (
            <div className="mb-4 p-3 bg-red-950 border border-red-800 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-xs text-gray-500 tracking-widest block mb-2">FULL NAME</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-[#555] transition-colors"
                placeholder="Your name"
                required
              />
            </div>

            <div>
              <label className="text-xs text-gray-500 tracking-widest block mb-2">EMAIL</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-[#555] transition-colors"
                placeholder="you@email.com"
                required
              />
            </div>

            <div>
              <label className="text-xs text-gray-500 tracking-widest block mb-2">PASSWORD</label>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-[#555] transition-colors"
                placeholder="Min 6 characters"
                required
              />
            </div>

            <div>
              <label className="text-xs text-gray-500 tracking-widest block mb-2">I AM A</label>
              <div className="grid grid-cols-2 gap-3">
                {["rider", "driver"].map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setForm({ ...form, role: r })}
                    className={`py-3 rounded-xl text-sm font-medium border transition-colors capitalize ${
                      form.role === r
                        ? "bg-white text-black border-white"
                        : "bg-transparent text-gray-400 border-[#2a2a2a] hover:border-[#555]"
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>

            {form.role === "driver" && (
              <div className="space-y-3 pt-2 border-t border-[#222]">
                <p className="text-xs text-gray-500 tracking-widest pt-2">VEHICLE INFO</p>
                <input
                  type="text"
                  value={form.vehicle.model}
                  onChange={(e) => setForm({ ...form, vehicle: { ...form.vehicle, model: e.target.value } })}
                  className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-[#555]"
                  placeholder="Vehicle model (e.g. Toyota Camry)"
                />
                <input
                  type="text"
                  value={form.vehicle.plate}
                  onChange={(e) => setForm({ ...form, vehicle: { ...form.vehicle, plate: e.target.value } })}
                  className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-[#555]"
                  placeholder="License plate"
                />
                <select
                  value={form.vehicle.type}
                  onChange={(e) => setForm({ ...form, vehicle: { ...form.vehicle, type: e.target.value } })}
                  className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-[#555]"
                >
                  <option value="standard">Standard</option>
                  <option value="comfort">Comfort</option>
                  <option value="black">Black</option>
                </select>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-white text-black rounded-xl py-3 text-sm font-medium tracking-wide hover:bg-gray-100 transition-colors disabled:opacity-50 mt-2"
            >
              {loading ? "Creating account..." : "Create account"}
            </button>
          </form>

          <p className="text-center text-gray-600 text-sm mt-6">
            Have an account?{" "}
            <Link to="/login" className="text-white hover:text-gray-300 transition-colors">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}