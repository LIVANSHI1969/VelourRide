import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import api from "../services/api";
import { useAuth } from "../context/AuthContext";

const TOPUP_PRESETS = [100, 250, 500, 1000, 2000, 5000];

const CATEGORY_META = {
  ride_payment: { label: "Ride Payment",  icon: "🚗", color: "#EF4444" },
  ride_earning: { label: "Ride Earning",  icon: "💰", color: "#10B981" },
  top_up:       { label: "Top-Up",        icon: "➕", color: "#3B82F6" },
  refund:       { label: "Refund",        icon: "↩️", color: "#8B5CF6" },
  bonus:        { label: "Bonus",         icon: "🎁", color: "#F59E0B" },
};

const fmt = (n) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);

const fmtDate = (d) =>
  new Date(d).toLocaleString("en-IN", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });

export default function Wallet() {
  const navigate  = useNavigate();
  const { user }  = useAuth();

  const [wallet,       setWallet]       = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [topupAmt,     setTopupAmt]     = useState("");
  const [customAmt,    setCustomAmt]    = useState("");
  const [topping,      setTopping]      = useState(false);
  const [error,        setError]        = useState("");
  const [success,      setSuccess]      = useState("");
  const [tab,          setTab]          = useState("all"); // all | credit | debit

  const fetchWallet = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/wallet");
      setWallet(data.wallet);
      setTransactions(data.transactions);
    } catch (e) {
      setError("Failed to load wallet");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchWallet(); }, []);

  const handleTopUp = async () => {
    const amount = parseFloat(topupAmt || customAmt);
    if (!amount || amount <= 0) { setError("Enter a valid amount"); return; }
    if (amount > 50000) { setError("Max top-up is ₹50,000 at once"); return; }

    setTopping(true); setError(""); setSuccess("");
    try {
      const { data } = await api.post("/wallet/topup", { amount });
      setWallet(prev => ({ ...prev, balance: data.balance }));
      setTransactions(prev => [data.transaction, ...prev]);
      setTopupAmt(""); setCustomAmt("");
      setSuccess(`✓ ${fmt(amount)} added to your wallet!`);
      setTimeout(() => setSuccess(""), 4000);
    } catch (e) {
      setError(e.response?.data?.message || "Top-up failed");
    } finally {
      setTopping(false);
    }
  };

  const filtered = transactions.filter(t =>
    tab === "all" ? true : t.type === tab
  );

  const totalCredit = transactions.filter(t => t.type === "credit").reduce((s, t) => s + t.amount, 0);
  const totalDebit  = transactions.filter(t => t.type === "debit" ).reduce((s, t) => s + t.amount, 0);

  if (loading) return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      <div className="text-center space-y-3">
        <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-gray-500 text-sm">Loading wallet...</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-black text-white">

      {/* Header */}
      <div className="border-b border-[#1a1a1a] px-6 py-4 flex justify-between items-center">
        <div>
          <h1 className="text-lg tracking-[0.2em] font-light">VELOUR</h1>
          <p className="text-xs text-gray-600 tracking-widest">WALLET</p>
        </div>
        <button onClick={() => navigate(-1)}
          className="text-xs text-gray-500 hover:text-white border border-[#333] px-3 py-1.5 rounded-lg transition-colors">
          ← Back
        </button>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-5">

        {/* ── Balance card ── */}
        <div className="relative rounded-2xl overflow-hidden p-6"
          style={{ background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)" }}>
          {/* Decorative ring */}
          <div className="absolute -top-12 -right-12 w-40 h-40 rounded-full border border-white/5" />
          <div className="absolute -top-6 -right-6 w-28 h-28 rounded-full border border-white/5" />

          <p className="text-xs text-blue-300/70 tracking-widest mb-1">AVAILABLE BALANCE</p>
          <p className="text-4xl font-bold tracking-tight">
            {wallet ? fmt(wallet.balance) : "—"}
          </p>
          <div className="mt-4 flex gap-6">
            <div>
              <p className="text-[10px] text-green-400/70 tracking-wider">TOTAL CREDITED</p>
              <p className="text-sm font-semibold text-green-400">{fmt(totalCredit)}</p>
            </div>
            <div>
              <p className="text-[10px] text-red-400/70 tracking-wider">TOTAL SPENT</p>
              <p className="text-sm font-semibold text-red-400">{fmt(totalDebit)}</p>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <p className="text-xs text-gray-400">{user?.name} · {user?.role}</p>
          </div>
        </div>

        {/* ── Top-up panel ── */}
        <div className="bg-[#111] border border-[#222] rounded-2xl p-5 space-y-4">
          <h2 className="text-sm font-semibold tracking-wide">Add Money</h2>

          {/* Preset chips */}
          <div className="grid grid-cols-3 gap-2">
            {TOPUP_PRESETS.map(amt => (
              <button key={amt}
                onClick={() => { setTopupAmt(String(amt)); setCustomAmt(""); setError(""); }}
                className={`py-2.5 rounded-xl text-sm font-medium transition-all border ${
                  topupAmt === String(amt)
                    ? "bg-white text-black border-white"
                    : "bg-[#1a1a1a] text-gray-300 border-[#2a2a2a] hover:border-[#555]"
                }`}>
                {fmt(amt)}
              </button>
            ))}
          </div>

          {/* Custom amount */}
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-sm">₹</span>
            <input
              type="number"
              value={customAmt}
              onChange={e => { setCustomAmt(e.target.value); setTopupAmt(""); setError(""); }}
              placeholder="Custom amount"
              min="1" max="50000"
              className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl
                pl-8 pr-4 py-3 text-sm text-white outline-none
                focus:border-[#555] transition-colors placeholder-gray-600"
            />
          </div>

          {error  && <p className="text-xs text-red-400 bg-red-400/10 px-3 py-2 rounded-lg">{error}</p>}
          {success && <p className="text-xs text-green-400 bg-green-400/10 px-3 py-2 rounded-lg">{success}</p>}

          <button
            onClick={handleTopUp}
            disabled={topping || (!topupAmt && !customAmt)}
            className="w-full py-3.5 rounded-xl bg-white text-black font-semibold text-sm
              hover:bg-gray-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {topping ? "Adding..." : `Add ${topupAmt || customAmt ? fmt(parseFloat(topupAmt || customAmt) || 0) : "Money"}`}
          </button>
        </div>

        {/* ── Transaction history ── */}
        <div className="bg-[#111] border border-[#222] rounded-2xl overflow-hidden">
          {/* Header + tabs */}
          <div className="px-5 pt-5 pb-3 border-b border-[#1e1e1e]">
            <h2 className="text-sm font-semibold tracking-wide mb-3">Transaction History</h2>
            <div className="flex gap-2">
              {[["all","All"],["credit","Credits"],["debit","Debits"]].map(([val, label]) => (
                <button key={val} onClick={() => setTab(val)}
                  className={`text-xs px-3 py-1.5 rounded-full transition-all ${
                    tab === val
                      ? "bg-white text-black font-semibold"
                      : "bg-[#1a1a1a] text-gray-400 border border-[#2a2a2a] hover:border-[#444]"
                  }`}>{label}
                </button>
              ))}
            </div>
          </div>

          {/* List */}
          {filtered.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <p className="text-3xl mb-3">💳</p>
              <p className="text-gray-500 text-sm">No transactions yet</p>
              <p className="text-gray-700 text-xs mt-1">Top up your wallet to get started</p>
            </div>
          ) : (
            <div className="divide-y divide-[#1a1a1a]">
              {filtered.map((txn, i) => {
                const meta    = CATEGORY_META[txn.category] || CATEGORY_META.top_up;
                const isDebit = txn.type === "debit";
                return (
                  <div key={txn._id || i} className="flex items-center gap-3 px-5 py-4 hover:bg-[#161616] transition-colors">

                    {/* Icon */}
                    <div className="w-10 h-10 rounded-full flex items-center justify-center text-lg shrink-0"
                      style={{ background: meta.color + "1a" }}>
                      {meta.icon}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">{txn.description}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] px-1.5 py-0.5 rounded"
                          style={{ background: meta.color + "22", color: meta.color }}>
                          {meta.label}
                        </span>
                        <span className="text-[10px] text-gray-600">{fmtDate(txn.createdAt)}</span>
                      </div>
                    </div>

                    {/* Amount + balance after */}
                    <div className="text-right shrink-0">
                      <p className={`text-sm font-bold ${isDebit ? "text-red-400" : "text-green-400"}`}>
                        {isDebit ? "−" : "+"}{fmt(txn.amount)}
                      </p>
                      <p className="text-[10px] text-gray-600 mt-0.5">
                        Bal: {fmt(txn.balanceAfter)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Info note ── */}
        <p className="text-center text-[11px] text-gray-700 pb-4">
          This is a demo wallet — no real money involved.
          Wallet balance is deducted automatically on ride completion when payment method is "Wallet".
        </p>

      </div>
    </div>
  );
}