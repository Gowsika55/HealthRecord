import React, { useState, useRef, useEffect } from "react";

export default function Login({ onLoginSuccess }) {
  const [isRegistering, setIsRegistering] = useState(false);
  const [role, setRole] = useState("patient");
  const [formData, setFormData] = useState({
    username: "",
    password: "",
    name: "",
    doctorRegistrationId: "",
    dob: "",
    bloodGroup: "O+",
    gender: "Male",
    phone: "",
    emergencyContact: "",
    allergies: "",
    rfidUid: "",
  });
  const [file, setFile] = useState(null);
  const [message, setMessage] = useState({ text: "", type: "" });
  const [loading, setLoading] = useState(false);

  // Web Serial API state for scanning card directly during patient creation
  const [isSerialConnected, setIsSerialConnected] = useState(false);
  const serialPortRef = useRef(null);
  const serialReaderRef = useRef(null);
  const keepReadingRef = useRef(false);

  const disconnectUsbReader = async () => {
    keepReadingRef.current = false;
    if (serialReaderRef.current) {
      try {
        await serialReaderRef.current.cancel();
      } catch (e) {}
      try {
        serialReaderRef.current.releaseLock();
      } catch (e) {}
      serialReaderRef.current = null;
    }
    if (serialPortRef.current) {
      try {
        await serialPortRef.current.close();
      } catch (e) {}
      serialPortRef.current = null;
    }
    setIsSerialConnected(false);
  };

  const connectUsbReader = async () => {
    if (!("serial" in navigator)) {
      setMessage({
        text: "Web Serial API is not supported in this browser. Please use Google Chrome, Edge, or Opera to connect to the ESP32 via USB, or enter UID manually.",
        type: "warning"
      });
      return;
    }

    await disconnectUsbReader();

    try {
      const port = await navigator.serial.requestPort();
      if (!port.readable) {
        await port.open({ baudRate: 115200 });
      }

      serialPortRef.current = port;
      setIsSerialConnected(true);
      setMessage({
        text: "✓ ESP32 Connected! Tap your RFID card on the MFRC522 reader now...",
        type: "success"
      });

      readSerialStream(port);
    } catch (err) {
      console.error("Serial connection error:", err);
      setIsSerialConnected(false);
      serialPortRef.current = null;

      if (err.name === "NotFoundError") return;

      const errMsg = (err && err.message) ? err.message : String(err);
      if (errMsg.includes("Failed to open serial port") || errMsg.includes("Access denied") || err.name === "NetworkError") {
        setMessage({
          text: "Failed to open serial port (COM13). The port is locked by another app (e.g. Arduino Serial Monitor). Please close it and click Scan again.",
          type: "danger"
        });
      } else {
        setMessage({ text: "Could not connect to USB device: " + errMsg, type: "danger" });
      }
    }
  };

  const readSerialStream = async (port) => {
    keepReadingRef.current = true;
    let buffer = "";
    const decoder = new TextDecoder();
    let reader = null;

    try {
      reader = port.readable.getReader();
      serialReaderRef.current = reader;

      while (keepReadingRef.current) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() || "";

          for (const rawLine of lines) {
            const cleanLine = rawLine.trim();
            if (!cleanLine) continue;

            let extractedUid = "";
            if (/^UID\s*:/i.test(cleanLine)) {
              const rawUid = cleanLine.replace(/^UID\s*:\s*/i, "").trim();
              extractedUid = rawUid.replace(/[: -]/g, "").toUpperCase();
            } else if (cleanLine.startsWith("{") && cleanLine.endsWith("}")) {
              try {
                const parsed = JSON.parse(cleanLine);
                const raw = parsed.rfidUid || parsed.uid || "";
                if (raw) extractedUid = raw.toString().replace(/[: -]/g, "").toUpperCase();
              } catch (e) {}
            } else if (/^\[RFID SCAN\]\s*UID:\s*([0-9a-fA-F: -]+)/i.test(cleanLine)) {
              const match = cleanLine.match(/^\[RFID SCAN\]\s*UID:\s*([0-9a-fA-F: -]+)/i);
              if (match && match[1]) {
                extractedUid = match[1].split("(")[0].trim().replace(/[: -]/g, "").toUpperCase();
              }
            } else if (/^Card\s*UID:\s*([0-9a-fA-F: -]+)/i.test(cleanLine)) {
              const match = cleanLine.match(/^Card\s*UID:\s*([0-9a-fA-F: -]+)/i);
              if (match && match[1]) {
                extractedUid = match[1].trim().replace(/[: -]/g, "").toUpperCase();
              }
            } else {
              const match = cleanLine.match(/^([0-9a-fA-F]{2}[: -]?){3,9}[0-9a-fA-F]{2}$/);
              if (match) {
                extractedUid = match[0].replace(/[: -]/g, "").toUpperCase();
              }
            }

            if (extractedUid && /^[0-9A-F]{4,20}$/.test(extractedUid)) {
              console.log("[Patient Registration] Captured RFID UID:", extractedUid);
              setFormData(prev => ({ ...prev, rfidUid: extractedUid }));
              setMessage({
                text: `✓ RFID Card Scanned! UID: ${extractedUid} captured.`,
                type: "success"
              });
              disconnectUsbReader();
              break;
            }
          }
        }
      }
    } catch (err) {
      if (keepReadingRef.current) {
        console.error("Serial stream read error:", err);
      }
    } finally {
      if (reader) {
        try { reader.releaseLock(); } catch (e) {}
      }
      serialReaderRef.current = null;
      setIsSerialConnected(false);
    }
  };

  useEffect(() => {
    return () => {
      disconnectUsbReader();
    };
  }, []);

  const handleInputChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage({ text: "", type: "" });
    setLoading(true);

    try {
      if (isRegistering) {
        // Register Flow (Gasless: Backend generates blockchain identity)
        const regData = new FormData();
        regData.append("username", formData.username);
        regData.append("password", formData.password);
        regData.append("name", formData.name);
        regData.append("role", role);

        if (role === "patient") {
          if (!formData.dob) {
            setMessage({ text: "Please enter your date of birth", type: "danger" });
            setLoading(false);
            return;
          }
          if (!formData.rfidUid || !formData.rfidUid.trim()) {
            setMessage({
              text: "RFID Smart Card UID is required. Please scan your RFID card via USB or enter the UID.",
              type: "danger"
            });
            setLoading(false);
            return;
          }
          regData.append("dob", formData.dob);
          regData.append("bloodGroup", formData.bloodGroup || "Unknown");
          regData.append("gender", formData.gender || "");
          regData.append("phone", formData.phone || "");
          regData.append("emergencyContact", formData.emergencyContact || "");
          regData.append("allergies", formData.allergies || "None");
          regData.append("rfidUid", formData.rfidUid.trim().toUpperCase());
        } else if (role === "doctor") {
          if (!formData.doctorRegistrationId || !formData.doctorRegistrationId.trim()) {
            setMessage({ text: "Doctor Registration ID is required", type: "danger" });
            setLoading(false);
            return;
          }
          if (!file) {
            setMessage({ text: "Please upload your qualification certificate (PDF/Image)", type: "danger" });
            setLoading(false);
            return;
          }
          regData.append("doctorRegistrationId", formData.doctorRegistrationId.trim());
          regData.append("certificate", file);
        }

        const response = await fetch("http://localhost:5000/api/auth/register", {
          method: "POST",
          body: regData,
        });

        const data = await response.json();
        if (response.ok) {
          setMessage({
            text: role === "doctor"
              ? `Doctor account registered! Address: ${data.walletAddress.substring(0, 10)}... Awaiting Administrator verification & on-chain blockchain approval.`
              : `Registration successful! ${data.rfidUid ? `RFID Card UID (${data.rfidUid}) linked to your account. ` : ""}You can now log in.`,
            type: "success",
          });
          setIsRegistering(false);
        } else {
          setMessage({ text: data.message || "Registration failed", type: "danger" });
        }
      } else {
        // Login Flow
        const response = await fetch("http://localhost:5000/api/auth/login", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            username: formData.username,
            password: formData.password,
          }),
        });

        const data = await response.json();
        if (response.ok) {
          onLoginSuccess(data.token, data.user);
        } else {
          setMessage({ text: data.message || "Login failed. Check your username and password.", type: "danger" });
        }
      }
    } catch (error) {
      console.error(error);
      setMessage({ text: "Network error. Please make sure the backend server is running on port 5000.", type: "danger" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ position: "relative", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "1.5rem" }}>
      <div className="hero-glow"></div>
      <div className="glass-card" style={{ width: "100%", maxWidth: "520px" }}>
        <h2 style={{ textAlign: "center", marginBottom: "0.25rem" }} className="title-glow">
          EHR Blockchain Ledger
        </h2>
        <p style={{ textAlign: "center", color: "var(--text-secondary)", marginBottom: "1.5rem", fontSize: "0.95rem" }}>
          Decentralized Health Records with Smart Contract Access Control
        </p>

        {/* Architecture Role Guide Banner */}
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border-glass)", borderRadius: "8px", padding: "0.75rem 1rem", marginBottom: "1.5rem", fontSize: "0.8rem", color: "var(--text-secondary)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.5rem", textAlign: "center" }}>
            <div style={{ borderRight: "1px solid var(--border-glass)", paddingRight: "0.25rem" }}>
              <strong style={{ color: "#60a5fa" }}>👤 Patient</strong>
              <div style={{ fontSize: "0.72rem", marginTop: "2px" }}>No MetaMask • No ETH</div>
            </div>
            <div style={{ borderRight: "1px solid var(--border-glass)", paddingRight: "0.25rem" }}>
              <strong style={{ color: "#34d399" }}>🩺 Doctor</strong>
              <div style={{ fontSize: "0.72rem", marginTop: "2px" }}>No MetaMask • No ETH</div>
            </div>
            <div>
              <strong style={{ color: "#f87171" }}>🔐 Admin (1 only)</strong>
              <div style={{ fontSize: "0.72rem", marginTop: "2px" }}>MetaMask • Test ETH</div>
            </div>
          </div>
        </div>

        {message.text && (
          <div className={`badge badge-${message.type}`} style={{ width: "100%", padding: "0.75rem", marginBottom: "1.5rem", borderRadius: "8px", textTransform: "none", fontSize: "0.9rem" }}>
            {message.text}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {isRegistering && (
            <div className="form-group">
              <label>Select Role to Register</label>
              <select value={role} onChange={(e) => setRole(e.target.value)} style={{ padding: "0.6rem" }}>
                <option value="patient">Patient (No MetaMask / No Gas Required)</option>
                <option value="doctor">Doctor (No MetaMask / No Gas Required)</option>
              </select>
            </div>
          )}

          <div className="form-group">
            <label>Username</label>
            <input
              type="text"
              name="username"
              className="form-input"
              required
              value={formData.username}
              onChange={handleInputChange}
              placeholder="e.g. johndoe"
            />
          </div>

          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              name="password"
              className="form-input"
              required
              value={formData.password}
              onChange={handleInputChange}
              placeholder="••••••••"
            />
          </div>

          {isRegistering && (
            <>
              <div className="form-group">
                <label>Full Name</label>
                <input
                  type="text"
                  name="name"
                  className="form-input"
                  required
                  value={formData.name}
                  onChange={handleInputChange}
                  placeholder={role === "doctor" ? "e.g. Dr. Jane Smith" : "e.g. John Doe"}
                />
              </div>

              {role === "patient" && (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                    <div className="form-group">
                      <label>Date of Birth</label>
                      <input
                        type="date"
                        name="dob"
                        className="form-input"
                        required
                        value={formData.dob}
                        onChange={handleInputChange}
                      />
                    </div>
                    <div className="form-group">
                      <label>Blood Group</label>
                      <select
                        name="bloodGroup"
                        className="form-input"
                        value={formData.bloodGroup}
                        onChange={handleInputChange}
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
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                    <div className="form-group">
                      <label>Gender</label>
                      <select
                        name="gender"
                        className="form-input"
                        value={formData.gender}
                        onChange={handleInputChange}
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
                        name="phone"
                        className="form-input"
                        placeholder="e.g. +1 234 567 890"
                        value={formData.phone}
                        onChange={handleInputChange}
                      />
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                    <div className="form-group">
                      <label>Emergency Contact</label>
                      <input
                        type="tel"
                        name="emergencyContact"
                        className="form-input"
                        placeholder="e.g. +1 987 654 321"
                        value={formData.emergencyContact}
                        onChange={handleInputChange}
                      />
                    </div>
                    <div className="form-group">
                      <label>Known Allergies</label>
                      <input
                        type="text"
                        name="allergies"
                        className="form-input"
                        placeholder="e.g. Penicillin, Peanuts (or None)"
                        value={formData.allergies}
                        onChange={handleInputChange}
                      />
                    </div>
                  </div>

                  {/* Required RFID Card Scanning Section */}
                  <div style={{ background: "rgba(15, 23, 42, 0.75)", border: "1px solid rgba(56, 189, 248, 0.4)", borderRadius: "8px", padding: "1rem", marginTop: "0.5rem", marginBottom: "1rem" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem", flexWrap: "wrap", gap: "0.5rem" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        <span style={{ fontSize: "1.25rem" }}>💳</span>
                        <div>
                          <strong style={{ fontSize: "0.9rem", color: "#38bdf8" }}>RFID Smart Card (Required)</strong>
                          <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                            Scan your physical card via ESP32 USB reader, or type UID
                          </div>
                        </div>
                      </div>

                      {!isSerialConnected ? (
                        <button
                          type="button"
                          className="btn btn-primary"
                          style={{ padding: "0.35rem 0.75rem", fontSize: "0.75rem", background: "linear-gradient(135deg, #0284c7, #2563eb)" }}
                          onClick={connectUsbReader}
                        >
                          🔌 Scan Card via USB
                        </button>
                      ) : (
                        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                          <span style={{ fontSize: "0.75rem", color: "#4ade80" }}>✓ Listening for Card Tap...</span>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ padding: "0.2rem 0.5rem", fontSize: "0.7rem", borderColor: "#f87171", color: "#f87171" }}
                            onClick={disconnectUsbReader}
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>

                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      <input
                        type="text"
                        name="rfidUid"
                        className="form-input"
                        required
                        placeholder="Scan card via USB or enter UID (e.g. B3E24256)"
                        value={formData.rfidUid}
                        onChange={handleInputChange}
                        style={{ fontFamily: "monospace", letterSpacing: "1px", fontWeight: "bold", color: formData.rfidUid ? "#38bdf8" : "inherit" }}
                      />
                      {formData.rfidUid && (
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ padding: "0.35rem 0.65rem", fontSize: "0.75rem" }}
                          onClick={() => setFormData({ ...formData, rfidUid: "" })}
                          title="Clear UID"
                        >
                          ✕
                        </button>
                      )}
                    </div>

                    <small style={{ color: "var(--text-secondary)", fontSize: "0.72rem", display: "block", marginTop: "6px" }}>
                      🔒 <strong>Strictly Required:</strong> Your EHR is permanently associated with this card UID so doctors can open your medical records by scanning this card.
                    </small>
                  </div>
                </>
              )}

              {role === "doctor" && (
                <>
                  <div className="form-group">
                    <label>Doctor Registration ID</label>
                    <input
                      type="text"
                      name="doctorRegistrationId"
                      className="form-input"
                      required
                      placeholder="e.g. DOC-REG-12345"
                      value={formData.doctorRegistrationId}
                      onChange={handleInputChange}
                    />
                  </div>
                  <div className="form-group">
                    <label>Upload Qualification Certificate (PDF or Image)</label>
                    <input
                      type="file"
                      accept=".pdf, image/*"
                      required
                      onChange={handleFileChange}
                      style={{ background: "transparent", border: "none", padding: 0 }}
                    />
                    <small style={{ color: "var(--text-secondary)", fontSize: "0.75rem", display: "block", marginTop: "4px" }}>
                      The Administrator will review this certificate and authorize your address on the blockchain.
                    </small>
                  </div>
                </>
              )}
            </>
          )}

          <button 
            type="submit" 
            className={`btn btn-${role === "doctor" ? "doctor" : "patient"}`} 
            style={{ width: "100%", marginTop: "1rem" }}
            disabled={loading}
          >
            {loading ? <div className="spinner" style={{ margin: "0 auto" }}></div> : (isRegistering ? "Create Account" : "Access EHR Portal")}
          </button>

          <p style={{ textAlign: "center", marginTop: "1.5rem", fontSize: "0.9rem" }}>
            {isRegistering ? "Already have an account?" : "Need a new patient or doctor account?"}{" "}
            <span
              style={{ color: "#3b82f6", cursor: "pointer", textDecoration: "underline" }}
              onClick={() => {
                setIsRegistering(!isRegistering);
                setMessage({ text: "", type: "" });
              }}
            >
              {isRegistering ? "Log In here" : "Register here"}
            </span>
          </p>

          {/* {!isRegistering && (
            <div style={{ marginTop: "1.25rem", paddingTop: "1rem", borderTop: "1px solid var(--border-glass)", textAlign: "center", fontSize: "0.8rem", color: "var(--text-muted)" }}>
              <span>Admin Login: <code>admin</code> or <code>admin@gmail.com</code> / <code>123789</code></span>
            </div>
          )} */}
        </form>
      </div>
    </div>
  );
}
