import React, { useState, useEffect } from "react";
import contractData from "../contracts/MedicalRecords.json";

// Helper: Calculate age from DOB
const calculateAge = (dobString) => {
  if (!dobString) return null;
  const birthDate = new Date(dobString);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age >= 0 ? age : null;
};

export default function PatientDashboard({ token, user, onLogout }) {
  const [activeTab, setActiveTab] = useState("records");
  const [currentUser, setCurrentUser] = useState(user);
  const [requests, setRequests] = useState([]);
  const [myRecords, setMyRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [txLoading, setTxLoading] = useState(false);
  const [message, setMessage] = useState({ text: "", type: "" });

  // Patient Bio Edit State
  const [isEditingBio, setIsEditingBio] = useState(false);
  const [bioSaving, setBioSaving] = useState(false);
  const [bioForm, setBioForm] = useState({
    name: user.name || "",
    dob: user.dob ? user.dob.split("T")[0] : "",
    bloodGroup: user.bloodGroup || "Unknown",
    gender: user.gender || "",
    phone: user.phone || "",
    emergencyContact: user.emergencyContact || "",
    allergies: user.allergies || "None",
    rfidUid: user.rfidUid || "",
  });

  const fetchRequests = async () => {
    try {
      const response = await fetch("http://localhost:5000/api/patient/requests", {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json();
      if (response.ok) {
        setRequests(data);
      }
    } catch (err) {
      console.error("Error fetching requests:", err);
    }
  };

  const fetchMyRecords = async () => {
    setLoading(true);
    try {
      const response = await fetch(`http://localhost:5000/api/records/patient/${currentUser.walletAddress}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json();
      if (response.ok) {
        setMyRecords(data);
      } else {
        console.error("Could not fetch records:", data.message);
      }
    } catch (err) {
      console.error("Error fetching records from blockchain:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateBio = async (e) => {
    e.preventDefault();
    if (!bioForm.rfidUid || !bioForm.rfidUid.trim()) {
      setMessage({ text: "RFID Card UID is required and cannot be removed.", type: "danger" });
      return;
    }
    setBioSaving(true);
    setMessage({ text: "", type: "" });
    try {
      const response = await fetch("http://localhost:5000/api/patient/profile", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(bioForm)
      });
      const data = await response.json();
      if (response.ok) {
        setCurrentUser(data.user);
        localStorage.setItem("user", JSON.stringify(data.user));
        setMessage({ text: "Patient bio details updated successfully!", type: "success" });
        setIsEditingBio(false);
      } else {
        setMessage({ text: data.message || "Failed to update bio", type: "danger" });
      }
    } catch (err) {
      console.error("Error updating bio:", err);
      setMessage({ text: "Server error updating bio", type: "danger" });
    } finally {
      setBioSaving(false);
    }
  };

  useEffect(() => {
    fetchRequests();
    fetchMyRecords();
  }, [token]);

  const handleApprove = async (reqItem) => {
    setMessage({ text: "", type: "" });
    setTxLoading(true);
    try {
      // Respond to access request (Triggers backend blockchain grantAccess tx!)
      const response = await fetch("http://localhost:5000/api/patient/respond-request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ requestId: reqItem._id, status: "approved" })
      });

      const data = await response.json();
      if (response.ok) {
        setMessage({ text: `Access granted to Dr. ${reqItem.doctorName} successfully on-chain!`, type: "success" });
        fetchRequests();
      } else {
        setMessage({ text: data.message || "Failed to approve request", type: "danger" });
      }
    } catch (error) {
      console.error("Grant access error:", error);
      setMessage({ text: "Server error occurred during on-chain approval", type: "danger" });
    } finally {
      setTxLoading(false);
    }
  };

  const handleRevoke = async (reqItem) => {
    setMessage({ text: "", type: "" });
    setTxLoading(true);
    try {
      // Respond to access request (Triggers backend blockchain revokeAccess tx!)
      const response = await fetch("http://localhost:5000/api/patient/respond-request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ requestId: reqItem._id, status: "revoked" })
      });

      const data = await response.json();
      if (response.ok) {
        setMessage({ text: `Access revoked from Dr. ${reqItem.doctorName} on-chain & off-chain.`, type: "success" });
        fetchRequests();
      } else {
        setMessage({ text: data.message || "Failed to revoke access", type: "danger" });
      }
    } catch (error) {
      console.error("Revoke access error:", error);
      setMessage({ text: "Server error occurred during revocation", type: "danger" });
    } finally {
      setTxLoading(false);
    }
  };

  const handleReject = async (reqItem) => {
    setMessage({ text: "", type: "" });
    try {
      const response = await fetch("http://localhost:5000/api/patient/respond-request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ requestId: reqItem._id, status: "rejected" })
      });

      if (response.ok) {
        setMessage({ text: `Request from Dr. ${reqItem.doctorName} has been rejected.`, type: "info" });
        fetchRequests();
      }
    } catch (error) {
      console.error("Reject request error:", error);
      setMessage({ text: "Failed to reject request", type: "danger" });
    }
  };

  return (
    <div>
      {/* Navbar */}
      <nav className="navbar">
        <a href="#" className="nav-brand">
          <span>EHR Blockchain</span> Patient Portal
        </a>
        <div className="nav-user">
          <div className="wallet-badge">
            <div className="wallet-dot"></div>
            <span>{currentUser.rfidUid ? `RFID: ${currentUser.rfidUid}` : (currentUser.patientId ? `ID: ${currentUser.patientId}` : "Patient")}</span>
          </div>
          <button className="btn btn-secondary" onClick={onLogout} style={{ padding: "0.5rem 1rem" }}>
            Logout
          </button>
        </div>
      </nav>

      <div className="container">
        {message.text && (
          <div className={`badge badge-${message.type}`} style={{ width: "100%", padding: "1rem", marginBottom: "1.5rem", borderRadius: "8px", textTransform: "none", fontSize: "1rem" }}>
            {message.text}
          </div>
        )}

        {txLoading && (
          <div className="badge badge-warning" style={{ width: "100%", padding: "1rem", marginBottom: "1.5rem", borderRadius: "8px", textTransform: "none", fontSize: "1rem", display: "flex", gap: "0.5rem", justifyContent: "center" }}>
            <div className="spinner"></div>
            Broadcasting transaction block to Ethereum... confirming on-chain...
          </div>
        )}

        {/* Patient Profile & Bio Card */}
        <div className="glass-card" style={{ marginBottom: "2rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem", borderBottom: "1px solid var(--border-glass)", paddingBottom: "1.25rem", marginBottom: "1.25rem" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
                <h2 className="title-glow" style={{ margin: 0 }}>Welcome, {currentUser.name}</h2>
                <span className="badge badge-patient" style={{ fontSize: "0.75rem", padding: "0.25rem 0.65rem" }}>
                  PATIENT PORTAL
                </span>
                {currentUser.rfidUid ? (
                  <span className="badge badge-primary" style={{ fontSize: "0.95rem", padding: "0.3rem 0.85rem", background: "rgba(56, 189, 248, 0.2)", border: "1px solid #38bdf8", color: "#38bdf8", fontWeight: "600" }}>
                    💳 RFID Card: {currentUser.rfidUid}
                  </span>
                ) : (
                  <span className="badge badge-warning" style={{ fontSize: "0.85rem", padding: "0.3rem 0.75rem" }}>
                    💳 No RFID Card Linked
                  </span>
                )}
              </div>
              <p style={{ color: "var(--text-secondary)", margin: "0.4rem 0 0 0", fontSize: "0.85rem" }}>
                Decentralized Wallet Address: <span className="hash-text">{currentUser.walletAddress}</span>
              </p>
            </div>
            <div>
              <button 
                className="btn btn-secondary" 
                style={{ padding: "0.45rem 0.9rem", fontSize: "0.85rem" }}
                onClick={() => setIsEditingBio(!isEditingBio)}
              >
                {isEditingBio ? "✕ Cancel Editing" : "✏️ Edit Patient Bio"}
              </button>
            </div>
          </div>

          {!isEditingBio ? (
            /* Bio Summary Grid */
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "1rem" }}>
              <div style={{ background: "rgba(255,255,255,0.02)", padding: "0.75rem 1rem", borderRadius: "8px", border: "1px solid var(--border-glass)" }}>
                <span style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", textTransform: "uppercase", marginBottom: "0.35rem" }}>
                  🩸 Blood Group
                </span>
                <span className="badge" style={{ background: "rgba(239, 68, 68, 0.15)", color: "#f87171", border: "1px solid rgba(239, 68, 68, 0.3)", fontSize: "0.95rem", fontWeight: 700, padding: "0.2rem 0.6rem" }}>
                  {currentUser.bloodGroup || "Unknown"}
                </span>
              </div>

              <div style={{ background: "rgba(255,255,255,0.02)", padding: "0.75rem 1rem", borderRadius: "8px", border: "1px solid var(--border-glass)" }}>
                <span style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", textTransform: "uppercase", marginBottom: "0.35rem" }}>
                  📅 Date of Birth
                </span>
                <strong style={{ fontSize: "0.95rem" }}>
                  {currentUser.dob ? new Date(currentUser.dob).toLocaleDateString() : "Not Recorded"}
                </strong>
                {currentUser.dob && calculateAge(currentUser.dob) !== null && (
                  <span style={{ color: "var(--text-secondary)", marginLeft: "0.4rem", fontSize: "0.85rem" }}>
                    ({calculateAge(currentUser.dob)} yrs)
                  </span>
                )}
              </div>

              <div style={{ background: "rgba(255,255,255,0.02)", padding: "0.75rem 1rem", borderRadius: "8px", border: "1px solid var(--border-glass)" }}>
                <span style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", textTransform: "uppercase", marginBottom: "0.35rem" }}>
                  👤 Gender
                </span>
                <strong style={{ fontSize: "0.95rem" }}>
                  {currentUser.gender || "Not Recorded"}
                </strong>
              </div>

              <div style={{ background: "rgba(255,255,255,0.02)", padding: "0.75rem 1rem", borderRadius: "8px", border: "1px solid var(--border-glass)" }}>
                <span style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", textTransform: "uppercase", marginBottom: "0.35rem" }}>
                  💳 RFID Smart Card
                </span>
                {currentUser.rfidUid ? (
                  <strong style={{ fontSize: "0.95rem", color: "#38bdf8", fontFamily: "monospace", letterSpacing: "1px" }}>
                    🏷️ {currentUser.rfidUid}
                  </strong>
                ) : (
                  <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                    Not Registered (Scan at Clinic)
                  </span>
                )}
              </div>

              <div style={{ background: "rgba(255,255,255,0.02)", padding: "0.75rem 1rem", borderRadius: "8px", border: "1px solid var(--border-glass)" }}>
                <span style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", textTransform: "uppercase", marginBottom: "0.35rem" }}>
                  📞 Contact Phone
                </span>
                <strong style={{ fontSize: "0.95rem" }}>
                  {currentUser.phone || "Not Provided"}
                </strong>
              </div>

              <div style={{ background: "rgba(255,255,255,0.02)", padding: "0.75rem 1rem", borderRadius: "8px", border: "1px solid var(--border-glass)" }}>
                <span style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", textTransform: "uppercase", marginBottom: "0.35rem" }}>
                  🚨 Emergency Contact
                </span>
                <strong style={{ fontSize: "0.95rem" }}>
                  {currentUser.emergencyContact || "Not Provided"}
                </strong>
              </div>

              <div style={{ background: "rgba(255,255,255,0.02)", padding: "0.75rem 1rem", borderRadius: "8px", border: "1px solid var(--border-glass)" }}>
                <span style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", textTransform: "uppercase", marginBottom: "0.35rem" }}>
                  ⚠️ Known Allergies
                </span>
                <strong style={{ fontSize: "0.95rem", color: currentUser.allergies && currentUser.allergies.toLowerCase() !== "none" ? "#f87171" : "var(--text-primary)" }}>
                  {currentUser.allergies || "None"}
                </strong>
              </div>
            </div>
          ) : (
            /* Bio Edit Form */
            <form onSubmit={handleUpdateBio} style={{ background: "rgba(255,255,255,0.01)", padding: "1.25rem", borderRadius: "10px", border: "1px dashed var(--border-glass)" }}>
              <h4 style={{ margin: "0 0 1rem 0", color: "#38bdf8" }}>Update Basic Medical Details & Bio</h4>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
                <div className="form-group">
                  <label>Full Name</label>
                  <input
                    type="text"
                    className="form-input"
                    value={bioForm.name}
                    onChange={(e) => setBioForm({ ...bioForm, name: e.target.value })}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Date of Birth</label>
                  <input
                    type="date"
                    className="form-input"
                    value={bioForm.dob}
                    onChange={(e) => setBioForm({ ...bioForm, dob: e.target.value })}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Blood Group</label>
                  <select
                    className="form-input"
                    value={bioForm.bloodGroup}
                    onChange={(e) => setBioForm({ ...bioForm, bloodGroup: e.target.value })}
                  >
                    <option value="A+">A+</option>
                    <option value="A-">A-</option>
                    <option value="B+">B+</option>
                    <option value="B-">B-</option>
                    <option value="AB+">AB+</option>
                    <option value="AB-">AB-</option>
                    <option value="O+">O+</option>
                    <option value="O-">O-</option>
                    <option value="Unknown">Unknown</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Gender</label>
                  <select
                    className="form-input"
                    value={bioForm.gender}
                    onChange={(e) => setBioForm({ ...bioForm, gender: e.target.value })}
                  >
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Other">Other</option>
                    <option value="Prefer not to say">Prefer not to say</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Phone Number</label>
                  <input
                    type="tel"
                    className="form-input"
                    value={bioForm.phone}
                    onChange={(e) => setBioForm({ ...bioForm, phone: e.target.value })}
                    placeholder="+1 234 567 890"
                  />
                </div>
                <div className="form-group">
                  <label>Emergency Contact</label>
                  <input
                    type="tel"
                    className="form-input"
                    value={bioForm.emergencyContact}
                    onChange={(e) => setBioForm({ ...bioForm, emergencyContact: e.target.value })}
                    placeholder="+1 987 654 321"
                  />
                </div>
                <div className="form-group" style={{ gridColumn: "1 / -1" }}>
                  <label>Known Allergies</label>
                  <input
                    type="text"
                    className="form-input"
                    value={bioForm.allergies}
                    onChange={(e) => setBioForm({ ...bioForm, allergies: e.target.value })}
                    placeholder="e.g. Penicillin, Peanuts, Aspirin (or None)"
                  />
                </div>
                <div className="form-group">
                  <label>💳 RFID Card UID (Required)</label>
                  <input
                    type="text"
                    className="form-input"
                    required
                    value={bioForm.rfidUid}
                    onChange={(e) =>
                      setBioForm({ ...bioForm, rfidUid: e.target.value.toUpperCase().trim() })
                    }
                    placeholder="e.g. B3E24256"
                    style={{ fontFamily: "monospace", letterSpacing: "1px", fontWeight: "600", color: "#38bdf8" }}
                  />
                  <small style={{ color: "var(--text-secondary)", fontSize: "0.75rem" }}>
                    Doctors tap this physical card to identify and open your EHR.
                  </small>
                </div>
              </div>
              <div style={{ display: "flex", gap: "1rem", marginTop: "1rem" }}>
                <button type="submit" className="btn btn-patient" disabled={bioSaving}>
                  {bioSaving ? "Saving..." : "Save Bio Details"}
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => setIsEditingBio(false)}>
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Dashboard Columns */}
        <div className="dashboard-grid">
          <aside className="sidebar-nav">
            <div 
              className={`sidebar-link ${activeTab === "records" ? "active active-patient" : ""}`}
              onClick={() => setActiveTab("records")}
            >
              My Medical Records
            </div>
            <div 
              className={`sidebar-link ${activeTab === "requests" ? "active active-patient" : ""}`}
              onClick={() => setActiveTab("requests")}
            >
              Doctor Access Approvals ({requests.filter(r => r.status === "pending").length})
            </div>
            <div 
              className={`sidebar-link ${activeTab === "audit" ? "active active-patient" : ""}`}
              onClick={() => setActiveTab("audit")}
            >
              Security Consent Audit
            </div>
          </aside>

          <main className="dashboard-content">
            {/* Sepolia Smart Contract Info Banner */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "rgba(59, 130, 246, 0.08)", border: "1px solid rgba(59, 130, 246, 0.25)", borderRadius: "8px", padding: "0.75rem 1.25rem", marginBottom: "1.5rem", flexWrap: "wrap", gap: "0.75rem" }}>
              <div>
                <span className="badge badge-primary" style={{ marginRight: "0.5rem", fontSize: "0.75rem" }}>
                  🌐 Network: Sepolia Testnet
                </span>
                <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                  Smart Contract: <strong className="hash-text">{contractData.address}</strong>
                </span>
              </div>
              <a 
                href={`https://sepolia.etherscan.io/address/${contractData.address}`}
                target="_blank" 
                rel="noreferrer" 
                className="btn btn-secondary" 
                style={{ padding: "0.25rem 0.65rem", fontSize: "0.75rem", color: "#38bdf8", borderColor: "#38bdf8" }}
              >
                🔍 Inspect Contract on Sepolia Etherscan ↗
              </a>
            </div>

            {activeTab === "records" && (
              <div className="glass-card">
                <h3>My Electronic Health History (Blockchain Log)</h3>
                <p style={{ color: "var(--text-secondary)", marginBottom: "1.5rem" }}>
                  All medical entries below are pulled directly from the Sepolia blockchain ledger. These records are permanent and mathematically tamper-proof.
                </p>

                {loading ? (
                  <div className="loader-container">
                    <div className="spinner"></div>
                    <p style={{ marginTop: "1rem" }}>Reading data blocks from smart contract...</p>
                  </div>
                ) : myRecords.length === 0 ? (
                  <p style={{ color: "var(--text-muted)", fontStyle: "italic" }}>No medical records have been appended yet.</p>
                ) : (
                  <div className="block-chain-explorer">
                    {myRecords.map((rec, i) => (
                      <div key={i} className="block-card">
                        <div className="block-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                            <span className="badge badge-success" style={{ fontSize: "0.75rem", padding: "0.2rem 0.5rem" }}>
                              ✓ {rec.status || "Success"}
                            </span>
                            <span className="badge badge-primary" style={{ fontSize: "0.75rem", padding: "0.2rem 0.5rem" }}>
                              Block #{rec.blockNumber || (i + 1)}
                            </span>
                          </div>
                          <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>Timestamp: {rec.timestamp}</span>
                        </div>
                        <h4 style={{ margin: "0.6rem 0 0.3rem 0", color: "#60a5fa" }}>Diagnosis: {rec.diagnosis}</h4>
                        <p style={{ margin: "0.4rem 0" }}><strong>Treatment Plan:</strong> {rec.treatment}</p>
                        {rec.notes && (
                          <p style={{ margin: "0.4rem 0", color: "var(--text-secondary)", fontStyle: "italic" }}>
                            <strong>Clinical Notes:</strong> {rec.notes}
                          </p>
                        )}
                        
                        <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "0.75rem", borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: "0.6rem", display: "flex", flexDirection: "column", gap: "5px" }}>
                          <div>
                            <strong>Status:</strong> <span className="badge badge-success" style={{ fontSize: "0.7rem", padding: "0.15rem 0.45rem", marginLeft: "4px" }}>Success (Mined)</span>
                          </div>
                          <div>
                            <strong>Block:</strong> <span style={{ color: "#e2e8f0", fontWeight: 600 }}>#{rec.blockNumber || (i + 1)}</span>
                          </div>
                          <div>
                            <strong>From:</strong>{" "}
                            <a 
                              href={`https://sepolia.etherscan.io/address/${rec.fromAddress || rec.doctorAddress}`} 
                              target="_blank" 
                              rel="noreferrer" 
                              className="hash-text" 
                              style={{ color: "#38bdf8", textDecoration: "underline" }}
                              title="View on Sepolia Etherscan"
                            >
                              {rec.fromAddress || rec.doctorAddress}
                            </a>{" "}
                            ({rec.doctorName})
                          </div>
                          <div>
                            <strong>To (Smart Contract):</strong>{" "}
                            <a 
                              href={`https://sepolia.etherscan.io/address/${rec.toAddress || rec.contractAddress}`} 
                              target="_blank" 
                              rel="noreferrer" 
                              className="hash-text" 
                              style={{ color: "#a78bfa", textDecoration: "underline" }}
                              title="View on Sepolia Etherscan"
                            >
                              {rec.toAddress || rec.contractAddress}
                            </a>
                          </div>
                          {rec.ipfsHash && (
                            <div style={{ marginTop: "6px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem", background: "rgba(16, 185, 129, 0.05)", padding: "0.4rem 0.6rem", borderRadius: "6px", border: "1px solid rgba(16, 185, 129, 0.2)" }}>
                              <span style={{ fontSize: "0.75rem" }}>
                                <strong>IPFS CID:</strong> <span className="hash-text" style={{ color: "#34d399" }}>{rec.ipfsHash}</span>
                              </span>
                              {rec.reportUrl && (
                                <a 
                                  href={`http://localhost:5000${rec.reportUrl}`} 
                                  target="_blank" 
                                  rel="noreferrer" 
                                  className="btn btn-secondary" 
                                  style={{ padding: "0.2rem 0.5rem", fontSize: "0.72rem", color: "#34d399", borderColor: "#34d399", whiteSpace: "nowrap" }}
                                >
                                  📄 View / Download Report ↗
                                </a>
                              )}
                            </div>
                          )}
                          {rec.txHash && (
                            <div style={{ marginTop: "6px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem", background: "rgba(56, 189, 248, 0.05)", padding: "0.4rem 0.6rem", borderRadius: "6px", border: "1px solid rgba(56, 189, 248, 0.2)" }}>
                              <span>
                                <strong>Transaction Hash:</strong>{" "}
                                <a 
                                  href={`https://sepolia.etherscan.io/tx/${rec.txHash}`} 
                                  target="_blank" 
                                  rel="noreferrer" 
                                  className="hash-text"
                                  style={{ color: "#38bdf8", textDecoration: "underline" }}
                                >
                                  {rec.txHash.substring(0, 16)}...{rec.txHash.substring(rec.txHash.length - 8)}
                                </a>
                              </span>
                              <a 
                                href={`https://sepolia.etherscan.io/tx/${rec.txHash}`} 
                                target="_blank" 
                                rel="noreferrer" 
                                className="btn btn-secondary" 
                                style={{ padding: "0.25rem 0.6rem", fontSize: "0.75rem", color: "#38bdf8", borderColor: "#38bdf8", whiteSpace: "nowrap" }}
                              >
                                🔍 View on Sepolia Etherscan ↗
                              </a>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === "requests" && (
              <div className="glass-card">
                <h3>Doctor Requests to Add Medical Reports</h3>
                <p style={{ color: "var(--text-secondary)", marginBottom: "1.5rem" }}>
                  Doctors can search and view your basic bio and medical history. Doctors who wish to add new medical reports, 
                  diagnoses, or prescriptions must obtain your permission. Approving a request grants on-chain consent to the doctor on the smart contract.
                </p>

                {requests.length === 0 ? (
                  <p style={{ color: "var(--text-muted)", fontStyle: "italic" }}>No requests received.</p>
                ) : (
                  <div className="table-container">
                    <table>
                      <thead>
                        <tr>
                          <th>Requesting Doctor</th>
                          <th>Doctor Address</th>
                          <th>Requested Permission</th>
                          <th>Status</th>
                          <th>Consent Decision</th>
                        </tr>
                      </thead>
                      <tbody>
                        {requests.map((reqItem) => (
                          <tr key={reqItem._id}>
                            <td><strong>{reqItem.doctorName}</strong></td>
                            <td className="hash-text">{reqItem.doctorAddress}</td>
                            <td>
                              <span className="badge badge-info" style={{ fontSize: "0.75rem", padding: "0.2rem 0.5rem", textTransform: "none" }}>
                                📄 Add Medical Records & Reports
                              </span>
                            </td>
                            <td>
                              <span className={`badge badge-${
                                reqItem.status === "approved" ? "success" :
                                reqItem.status === "pending" ? "warning" : "danger"
                              }`}>
                                {reqItem.status}
                              </span>
                            </td>
                            <td>
                              {reqItem.status === "pending" && (
                                <div style={{ display: "flex", gap: "0.5rem" }}>
                                  <button className="btn btn-doctor" style={{ padding: "0.4rem 0.8rem", fontSize: "0.85rem" }} onClick={() => handleApprove(reqItem)}>
                                    Approve Consent
                                  </button>
                                  <button className="btn btn-secondary" style={{ padding: "0.4rem 0.8rem", fontSize: "0.85rem", color: "var(--color-danger)" }} onClick={() => handleReject(reqItem)}>
                                    Reject
                                  </button>
                                </div>
                              )}
                              {reqItem.status === "approved" && (
                                <button className="btn btn-secondary" style={{ padding: "0.4rem 0.8rem", fontSize: "0.85rem", color: "var(--color-danger)" }} onClick={() => handleRevoke(reqItem)}>
                                  Revoke Consent
                                </button>
                              )}
                              {(reqItem.status === "rejected" || reqItem.status === "revoked") && (
                                <button className="btn btn-doctor" style={{ padding: "0.4rem 0.8rem", fontSize: "0.85rem" }} onClick={() => handleApprove(reqItem)}>
                                  Re-Approve Consent
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {activeTab === "audit" && (
              <div className="glass-card">
                <h3>Security Consent Audit Logs</h3>
                <p style={{ color: "var(--text-secondary)", marginBottom: "1.5rem" }}>
                  A history of consent approvals, rejections, and revocations for compliance auditing.
                </p>

                {requests.length === 0 ? (
                  <p style={{ color: "var(--text-muted)", fontStyle: "italic" }}>No audit log history.</p>
                ) : (
                  <div className="audit-list">
                    {requests.map((reqItem) => (
                      <div key={reqItem._id} className="audit-item">
                        <div>
                          <strong>Dr. {reqItem.doctorName}</strong> ({reqItem.doctorAddress.substring(0, 10)}...)
                          <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginTop: "0.25rem" }}>
                            Status transitioned to: <span style={{ textTransform: "uppercase", fontWeight: 600, color: reqItem.status === "approved" ? "var(--color-success)" : "var(--color-danger)" }}>{reqItem.status}</span>
                          </div>
                        </div>
                        <div style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
                          Last Updated: {new Date(reqItem.updatedAt).toLocaleString()}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
