import React, { useState, useEffect, useRef } from "react";
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

export default function DoctorDashboard({ token, user, onLogout }) {
  const [searchKey, setSearchKey] = useState("");
  const [searchResult, setSearchResult] = useState(null);
  const [patientRecords, setPatientRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [txLoading, setTxLoading] = useState(false);
  const [message, setMessage] = useState({ text: "", type: "" });
  
  // RFID Scanner State
  const [scannedUid, setScannedUid] = useState("");
  const [manualRfid, setManualRfid] = useState("");
  const [unassignedCard, setUnassignedCard] = useState(null);
  const [isSerialConnected, setIsSerialConnected] = useState(false);
  const [assignLoading, setAssignLoading] = useState(false);
  const serialPortRef = useRef(null);
  const serialReaderRef = useRef(null);
  const keepReadingRef = useRef(false);

  // Add Record Form State
  const [newRecord, setNewRecord] = useState({
    diagnosis: "",
    treatment: "",
    notes: ""
  });
  const [reportFile, setReportFile] = useState(null);

  // Cleanly disconnect and close Web Serial port and reader
  const disconnectUsbReader = async () => {
    keepReadingRef.current = false;

    if (serialReaderRef.current) {
      try {
        await serialReaderRef.current.cancel();
      } catch (err) {
        console.warn("Error cancelling serial reader:", err);
      }
      try {
        serialReaderRef.current.releaseLock();
      } catch (err) {
        console.warn("Error releasing serial reader lock:", err);
      }
      serialReaderRef.current = null;
    }

    if (serialPortRef.current) {
      try {
        await serialPortRef.current.close();
      } catch (err) {
        console.warn("Error closing serial port:", err);
      }
      serialPortRef.current = null;
    }

    setIsSerialConnected(false);
  };

  // Web Serial API (Direct USB connection to ESP32 DevKit V1)
  const connectUsbReader = async () => {
    if (!("serial" in navigator)) {
      setMessage({
        text: "Web Serial API is not supported in this browser. Please use Google Chrome, Microsoft Edge, or Opera to connect directly to the ESP32 via USB.",
        type: "warning"
      });
      return;
    }

    // Clean up any stale connection first before opening
    await disconnectUsbReader();

    try {
      // Request user to choose ESP32 / CP2102 COM port
      const port = await navigator.serial.requestPort();

      // Open COM port at 115200 baud
      if (!port.readable) {
        await port.open({ baudRate: 115200 });
      }

      serialPortRef.current = port;
      setIsSerialConnected(true);
      setMessage({
        text: "✓ ESP32 USB RFID Reader connected at 115200 baud! Tap any RFID card on the MFRC522.",
        type: "success"
      });

      // Begin reading stream
      readSerialStream(port);
    } catch (err) {
      console.error("Serial connection error:", err);
      setIsSerialConnected(false);
      serialPortRef.current = null;

      if (err.name === "NotFoundError") {
        // User closed or cancelled device chooser
        return;
      }

      const errMsg = (err && err.message) ? err.message : String(err);
      if (
        errMsg.includes("Failed to open serial port") ||
        errMsg.includes("Access denied") ||
        err.name === "NetworkError"
      ) {
        setMessage({
          text: "Failed to open serial port (COM13). Port is in exclusive use. Please ensure Arduino IDE's Serial Monitor is CLOSED, then click Connect ESP32 via USB again.",
          type: "danger"
        });
      } else {
        setMessage({
          text: "Could not connect to USB device: " + errMsg,
          type: "danger"
        });
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
          buffer = lines.pop() || ""; // retain incomplete line

          for (const rawLine of lines) {
            const cleanLine = rawLine.trim();
            if (!cleanLine) continue;

            console.log("[ESP32 Serial]", cleanLine);

            // Requirements 4 & 5: Detect the line starting with "UID:" and extract the RFID UID
            let extractedUid = "";

            if (/^UID\s*:/i.test(cleanLine)) {
              // Format: "UID: A3:7B:91:2F" or "UID: A3 7B 91 2F" or "UID: A37B912F"
              const rawUid = cleanLine.replace(/^UID\s*:\s*/i, "").trim();
              extractedUid = rawUid.replace(/[: -]/g, "").toUpperCase();
            } else if (cleanLine.startsWith("{") && cleanLine.endsWith("}")) {
              // JSON Format: {"rfidUid":"A37B912F"}
              try {
                const parsed = JSON.parse(cleanLine);
                const raw = parsed.rfidUid || parsed.uid || "";
                if (raw) extractedUid = raw.toString().replace(/[: -]/g, "").toUpperCase();
              } catch (e) {}
            } else if (/^\[RFID SCAN\]\s*UID:\s*([0-9a-fA-F: -]+)/i.test(cleanLine)) {
              // Debug log format: [RFID SCAN] UID: A37B912F (4 bytes)
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
              // Standalone hex match fallback
              const match = cleanLine.match(/^([0-9a-fA-F]{2}[: -]?){3,9}[0-9a-fA-F]{2}$/);
              if (match) {
                extractedUid = match[0].replace(/[: -]/g, "").toUpperCase();
              }
            }

            if (extractedUid && /^[0-9A-F]{4,20}$/.test(extractedUid)) {
              console.log("[ESP32 USB] Successfully extracted RFID UID:", extractedUid);
              handleRfidScan(extractedUid);
            }
          }
        }
      }
    } catch (err) {
      if (keepReadingRef.current) {
        console.error("Serial stream read error:", err);
        setMessage({
          text: "ESP32 serial connection lost: " + (err.message || err),
          type: "warning"
        });
      }
    } finally {
      if (reader) {
        try {
          reader.releaseLock();
        } catch (e) {}
      }
      serialReaderRef.current = null;
      setIsSerialConnected(false);
    }
  };

  // Disconnect serial port when unmounting
  useEffect(() => {
    return () => {
      disconnectUsbReader();
    };
  }, []);

  // Listen for physical device disconnection (e.g. USB unplugged)
  useEffect(() => {
    if (!("serial" in navigator)) return;
    const handleDisconnect = (event) => {
      if (serialPortRef.current && event.target === serialPortRef.current) {
        console.log("[Web Serial] ESP32 device disconnected");
        disconnectUsbReader();
        setMessage({ text: "ESP32 USB cable was disconnected.", type: "warning" });
      }
    };
    navigator.serial.addEventListener("disconnect", handleDisconnect);
    return () => {
      navigator.serial.removeEventListener("disconnect", handleDisconnect);
    };
  }, []);

  // Handle RFID Card Scan (Calls backend POST /api/rfid/scan)
  const handleRfidScan = async (uidToScan) => {
    if (!uidToScan) return;
    const cleanUid = uidToScan.trim().toUpperCase().replace(/[: -]/g, "");
    setScannedUid(cleanUid);
    setLoading(true);
    setUnassignedCard(null);
    setMessage({ text: `Scanning RFID Card (UID: ${cleanUid})...`, type: "info" });

    try {
      const response = await fetch("http://localhost:5000/api/rfid/scan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ rfidUid: cleanUid })
      });
      const data = await response.json();

      if (response.ok && data.patient) {
        setSearchResult({
          patient: data.patient,
          requestStatus: data.requestStatus || "none"
        });
        fetchPatientRecords(data.patient.walletAddress);
        const idLabel = data.patient.rfidUid ? `RFID: ${data.patient.rfidUid}` : (data.patient.patientId ? `ID: ${data.patient.patientId}` : "");
        setMessage({
          text: `✓ RFID Card Scanned! Identified Patient: ${data.patient.name} (${idLabel})`,
          type: "success"
        });
      } else if (response.status === 404) {
        setUnassignedCard(cleanUid);
        setMessage({
          text: `RFID Card scanned (${cleanUid}), but it is not linked to any registered patient yet.`,
          type: "warning"
        });
      } else {
        setMessage({ text: data.message || "Failed to scan RFID card", type: "danger" });
      }
    } catch (err) {
      console.error("RFID scan error:", err);
      setMessage({ text: "Error communicating with server during RFID scan", type: "danger" });
    } finally {
      setLoading(false);
    }
  };

  // Handle linking/assigning an RFID UID to a patient
  const handleAssignRfid = async (patientIdToAssign, cardUidToAssign) => {
    if (!patientIdToAssign || !cardUidToAssign) return;
    setAssignLoading(true);
    setMessage({ text: "", type: "" });
    try {
      const res = await fetch("http://localhost:5000/api/rfid/assign", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          patientId: patientIdToAssign,
          rfidUid: cardUidToAssign
        })
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ text: `✓ RFID Card (${cardUidToAssign}) successfully linked to ${data.patient.name}!`, type: "success" });
        setUnassignedCard(null);
        setSearchResult(prev => prev ? ({
          ...prev,
          patient: { ...prev.patient, rfidUid: cardUidToAssign }
        }) : null);
      } else {
        setMessage({ text: data.message || "Failed to link RFID card", type: "danger" });
      }
    } catch (err) {
      console.error("Assign RFID error:", err);
      setMessage({ text: "Error assigning RFID card", type: "danger" });
    } finally {
      setAssignLoading(false);
    }
  };

  // Periodic polling of /api/rfid/latest-scan to catch live taps (over Wi-Fi or Serial Bridge)
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch("http://localhost:5000/api/rfid/latest-scan");
        const data = await res.json();
        if (data.success && data.scan && data.scan.timestamp) {
          const timeDiff = Date.now() - data.scan.timestamp;
          if (timeDiff < 4000 && data.scan.rfidUid !== scannedUid) {
            setScannedUid(data.scan.rfidUid);
            if (data.scan.found && data.scan.patient) {
              setSearchResult({
                patient: data.scan.patient,
                requestStatus: data.scan.requestStatus || "none"
              });
              fetchPatientRecords(data.scan.patient.walletAddress);
              const liveIdLabel = data.scan.patient.rfidUid ? `RFID: ${data.scan.patient.rfidUid}` : (data.scan.patient.patientId ? `ID: ${data.scan.patient.patientId}` : "");
              setMessage({
                text: `✓ Live RFID Tap! Identified: ${data.scan.patient.name} (${liveIdLabel})`,
                type: "success"
              });
            } else {
              setUnassignedCard(data.scan.rfidUid);
              setMessage({
                text: `Live RFID Card tapped (${data.scan.rfidUid}) - Not assigned to any patient.`,
                type: "warning"
              });
            }
          }
        }
      } catch (e) {
        // Polling error ignored
      }
    }, 2500);

    return () => clearInterval(interval);
  }, [scannedUid, token]);

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchKey.trim()) return;

    setLoading(true);
    setSearchResult(null);
    setPatientRecords([]);
    setMessage({ text: "", type: "" });

    try {
      const response = await fetch(`http://localhost:5000/api/doctor/search-patient/${searchKey.trim()}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json();
      
      if (response.ok) {
        setSearchResult(data);
        // Per requirement: Approved doctors can view existing medical records upon searching patient ID
        fetchPatientRecords(data.patient.walletAddress);
      } else {
        setMessage({ text: data.message || "Patient not found", type: "danger" });
      }
    } catch (err) {
      console.error(err);
      setMessage({ text: "Error searching patient", type: "danger" });
    } finally {
      setLoading(false);
    }
  };

  const fetchPatientRecords = async (patientAddress) => {
    try {
      const response = await fetch(`http://localhost:5000/api/records/patient/${patientAddress}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json();
      if (response.ok) {
        setPatientRecords(data);
        // Clear any previous error banner
        setMessage({ text: "", type: "" });
      } else {
        setMessage({ text: data.message || "Could not retrieve records", type: "danger" });
      }
    } catch (err) {
      console.error("Error reading blockchain records:", err);
      setMessage({ text: "Access denied or backend blockchain connection error", type: "danger" });
    }
  };

  const handleCreatePatientId = async (walletAddress) => {
    setMessage({ text: "", type: "" });
    setLoading(true);
    try {
      const response = await fetch("http://localhost:5000/api/doctor/create-patient-id", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ patientWalletAddress: walletAddress })
      });
      const data = await response.json();
      
      if (response.ok) {
        setMessage({ text: `Patient ID generated successfully: ${data.patientId}`, type: "success" });
        setSearchResult(prev => ({
          ...prev,
          patient: { ...prev.patient, patientId: data.patientId }
        }));
      } else {
        setMessage({ text: data.message || "Failed to create ID", type: "danger" });
      }
    } catch (err) {
      console.error(err);
      setMessage({ text: "Error creating patient ID", type: "danger" });
    } finally {
      setLoading(false);
    }
  };

  const handleRequestAccess = async (target) => {
    setMessage({ text: "", type: "" });
    setLoading(true);
    try {
      const payload = typeof target === "object" && target !== null
        ? {
            patientId: target.patientId,
            rfidUid: target.rfidUid,
            patientWalletAddress: target.walletAddress
          }
        : {
            patientId: target,
            rfidUid: target
          };

      const response = await fetch("http://localhost:5000/api/doctor/request-access", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      const data = await response.json();

      if (response.ok) {
        setMessage({ text: "Access request sent successfully! Awaiting patient approval.", type: "success" });
        setSearchResult(prev => ({ ...prev, requestStatus: "pending" }));
      } else {
        setMessage({ text: data.message || "Failed to send request", type: "danger" });
      }
    } catch (err) {
      console.error(err);
      setMessage({ text: "Error sending request", type: "danger" });
    } finally {
      setLoading(false);
    }
  };

  const handleAddRecordSubmit = async (e) => {
    e.preventDefault();
    if (!newRecord.diagnosis.trim() || !newRecord.treatment.trim()) {
      alert("Diagnosis and Treatment are required!");
      return;
    }

    setMessage({ text: "", type: "" });
    setTxLoading(true);

    try {
      const patientAddress = searchResult.patient.walletAddress;
      
      const formData = new FormData();
      formData.append("patientAddress", patientAddress);
      formData.append("diagnosis", newRecord.diagnosis);
      formData.append("treatment", newRecord.treatment);
      formData.append("notes", newRecord.notes || "");
      if (reportFile) {
        formData.append("reportFile", reportFile);
      }

      const response = await fetch("http://localhost:5000/api/doctor/add-record", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`
        },
        body: formData
      });

      const data = await response.json();
      if (response.ok) {
        setMessage({ 
          text: `Medical record & report committed to the Ethereum ledger successfully! ${data.ipfsHash ? `(IPFS CID: ${data.ipfsHash})` : ""}`, 
          type: "success" 
        });
        setNewRecord({ diagnosis: "", treatment: "", notes: "" });
        setReportFile(null);
        fetchPatientRecords(patientAddress);
      } else {
        setMessage({ text: data.message || "On-chain record entry failed", type: "danger" });
      }
    } catch (error) {
      console.error("Add record error:", error);
      setMessage({ text: "Server error during block creation", type: "danger" });
    } finally {
      setTxLoading(false);
    }
  };

  return (
    <div>
      {/* Navbar */}
      <nav className="navbar">
        <a href="#" className="nav-brand">
          <span>EHR Blockchain</span> Doctor Portal
        </a>
        <div className="nav-user">
          <div className="wallet-badge">
            <div className="wallet-dot" style={{ backgroundColor: user.status === "approved" ? "var(--color-success)" : "var(--color-warning)", boxShadow: user.status === "approved" ? "0 0 8px var(--color-success)" : "0 0 8px var(--color-warning)" }}></div>
            <span>Dr. {user.name} ({user.status.toUpperCase()})</span>
          </div>
          <button className="btn btn-secondary" onClick={onLogout} style={{ padding: "0.5rem 1rem" }}>
            Logout
          </button>
        </div>
      </nav>

      <div className="container">
        {user.status === "pending" ? (
          <div className="glass-card" style={{ textAlign: "center", padding: "4rem 2rem" }}>
            <h2 className="title-glow" style={{ color: "var(--color-warning)" }}>Verification Pending</h2>
            <p style={{ color: "var(--text-secondary)", maxWidth: "500px", margin: "1rem auto 2rem auto" }}>
              Your application credentials are currently being verified by the administrator. 
              Once the administrator signs your approval onto the blockchain registry, you will gain access.
            </p>
            <div className="spinner" style={{ margin: "0 auto", width: "40px", height: "40px" }}></div>
          </div>
        ) : user.status === "rejected" ? (
          <div className="glass-card" style={{ textAlign: "center", padding: "4rem 2rem" }}>
            <h2 className="title-glow" style={{ color: "var(--color-danger)" }}>Verification Rejected</h2>
            <p style={{ color: "var(--text-secondary)", maxWidth: "500px", margin: "1rem auto" }}>
              Your qualifications have been rejected by the administrator. Please contact support.
            </p>
          </div>
        ) : (
          <div>
            {message.text && (
              <div className={`badge badge-${message.type}`} style={{ width: "100%", padding: "1rem", marginBottom: "1.5rem", borderRadius: "8px", textTransform: "none", fontSize: "1rem" }}>
                {message.text}
              </div>
            )}

            {txLoading && (
              <div className="badge badge-warning" style={{ width: "100%", padding: "1rem", marginBottom: "1.5rem", borderRadius: "8px", textTransform: "none", fontSize: "1rem", display: "flex", gap: "0.5rem", justifyContent: "center" }}>
                <div className="spinner"></div>
                Mining transaction block... committing record to decentralized ledger
              </div>
            )}

            <div className="dashboard-grid">
              <aside className="sidebar-nav">
                <div className="sidebar-link active active-doctor">
                  Patient Search & Records
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

                {/* RFID Smart Card Reader Card */}
                <div className="glass-card" style={{ marginBottom: "2rem", border: "1px solid rgba(56, 189, 248, 0.3)", background: "rgba(15, 23, 42, 0.65)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem", marginBottom: "1rem" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                      <span style={{ fontSize: "1.5rem" }}>💳</span>
                      <div>
                        <h3 style={{ margin: 0, fontSize: "1.1rem" }}>RC522 RFID Smart Card Scanner</h3>
                        <p style={{ margin: "0.2rem 0 0 0", fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                          MFRC522 Reader via USB / Web Serial & Backend Sync
                        </p>
                      </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                      <span className="badge" style={{ 
                        background: isSerialConnected ? "rgba(34, 197, 94, 0.15)" : "rgba(148, 163, 184, 0.15)",
                        color: isSerialConnected ? "#4ade80" : "var(--text-secondary)",
                        border: isSerialConnected ? "1px solid rgba(34, 197, 94, 0.3)" : "1px solid rgba(148, 163, 184, 0.3)",
                        display: "flex",
                        alignItems: "center",
                        gap: "0.4rem",
                        padding: "0.35rem 0.75rem"
                      }}>
                        <span style={{
                          width: "8px",
                          height: "8px",
                          borderRadius: "50%",
                          backgroundColor: isSerialConnected ? "#4ade80" : "#94a3b8",
                          boxShadow: isSerialConnected ? "0 0 8px #4ade80" : "none"
                        }}></span>
                        {isSerialConnected ? "USB Serial Connected" : "USB Serial Disconnected"}
                      </span>

                      {!isSerialConnected ? (
                        <button
                          type="button"
                          className="btn btn-primary"
                          style={{ padding: "0.4rem 0.85rem", fontSize: "0.8rem", background: "linear-gradient(135deg, #0284c7, #2563eb)" }}
                          onClick={connectUsbReader}
                        >
                          🔌 Connect ESP32 via USB
                        </button>
                      ) : (
                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                          <span style={{ fontSize: "0.8rem", color: "#38bdf8" }}>✓ Listening for Card Taps...</span>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ padding: "0.3rem 0.65rem", fontSize: "0.75rem", borderColor: "#f87171", color: "#f87171" }}
                            onClick={disconnectUsbReader}
                            title="Disconnect ESP32 USB"
                          >
                            Disconnect
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Card Tap Status / Notice */}
                  {scannedUid && (
                    <div style={{ background: "rgba(56, 189, 248, 0.08)", border: "1px solid rgba(56, 189, 248, 0.25)", borderRadius: "8px", padding: "0.75rem 1rem", marginBottom: "1rem", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>Last Card Scanned:</span>
                        <code style={{ background: "rgba(0,0,0,0.4)", color: "#38bdf8", padding: "0.2rem 0.5rem", borderRadius: "4px", fontWeight: "bold", letterSpacing: "1px" }}>
                          {scannedUid}
                        </code>
                      </div>
                      {unassignedCard === scannedUid && (
                        <span className="badge badge-warning" style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem" }}>
                          ⚠️ Unassigned Card
                        </span>
                      )}
                    </div>
                  )}

                  {/* Unassigned Card Prompt */}
                  {unassignedCard && (
                    <div style={{ background: "rgba(234, 179, 8, 0.1)", border: "1px solid rgba(234, 179, 8, 0.3)", borderRadius: "8px", padding: "0.85rem 1rem", marginBottom: "1rem" }}>
                      <p style={{ margin: "0 0 0.5rem 0", fontSize: "0.85rem", color: "#facc15" }}>
                        <strong>Unlinked RFID Card Detected:</strong> UID <code>{unassignedCard}</code> is not associated with any patient yet.
                      </p>
                      {searchResult && searchResult.patient ? (
                        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
                          <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                            Assign this card to currently loaded patient <strong>{searchResult.patient.name}</strong> ({searchResult.patient.patientId || searchResult.patient.username}):
                          </span>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ padding: "0.3rem 0.75rem", fontSize: "0.8rem", borderColor: "#facc15", color: "#facc15" }}
                            disabled={assignLoading}
                            onClick={() => handleAssignRfid(searchResult.patient.patientId || searchResult.patient.walletAddress, unassignedCard)}
                          >
                            {assignLoading ? "Linking..." : `🔗 Link to ${searchResult.patient.name}`}
                          </button>
                        </div>
                      ) : (
                        <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                          Search for a patient below, then you can bind this RFID card directly to their account.
                        </p>
                      )}
                    </div>
                  )}

                  {/* Manual/Simulated UID Input for Testing */}
                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
                    <div style={{ flex: "1 1 200px", display: "flex", gap: "0.5rem" }}>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="Simulate/Manual RFID UID (e.g. B34A2C19)"
                        value={manualRfid}
                        onChange={(e) => setManualRfid(e.target.value.toUpperCase())}
                        style={{ fontSize: "0.85rem", padding: "0.45rem 0.75rem" }}
                      />
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ padding: "0.45rem 0.9rem", fontSize: "0.8rem", whiteSpace: "nowrap" }}
                        onClick={() => {
                          if (manualRfid.trim()) {
                            handleRfidScan(manualRfid.trim());
                          }
                        }}
                      >
                        ⚡ Simulate Tap
                      </button>
                    </div>
                    <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                      💡 Tip: Tap a physical RFID card on your ESP32 + MFRC522 reader, or simulate tap using a UID above.
                    </span>
                  </div>
                </div>

                {/* Search Panel */}
                <div className="glass-card" style={{ marginBottom: "2rem" }}>
                  <h3>Search Patient Profile</h3>
                  <form onSubmit={handleSearch} style={{ display: "flex", gap: "1rem", marginTop: "1rem" }}>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="Enter Patient ID (e.g. PAT-123456), RFID UID, or Username"
                      value={searchKey}
                      onChange={(e) => setSearchKey(e.target.value)}
                      disabled={loading}
                    />
                    <button type="submit" className="btn btn-doctor" disabled={loading}>
                      {loading ? "Searching..." : "Search"}
                    </button>
                  </form>
                </div>

                {/* Patient Search Results */}
                {searchResult && (
                  <div>
                    {/* Patient Bio & Details Card */}
                    <div className="glass-card" style={{ marginBottom: "2rem" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem", borderBottom: "1px solid var(--border-glass)", paddingBottom: "1.25rem", marginBottom: "1.25rem" }}>
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
                            <h2 style={{ margin: 0 }}>👤 {searchResult.patient.name}</h2>
                            <span className="badge badge-patient" style={{ fontSize: "0.75rem", padding: "0.25rem 0.65rem" }}>
                              PATIENT BIO
                            </span>
                            {searchResult.patient.rfidUid ? (
                              <span className="badge badge-primary" style={{ fontSize: "0.85rem", padding: "0.3rem 0.75rem", background: "rgba(56, 189, 248, 0.2)", border: "1px solid #38bdf8", color: "#38bdf8", fontWeight: "600" }}>
                                💳 RFID: {searchResult.patient.rfidUid}
                              </span>
                            ) : searchResult.patient.patientId ? (
                              <span className="badge badge-info" style={{ fontSize: "0.85rem", padding: "0.3rem 0.75rem" }}>
                                ID: {searchResult.patient.patientId}
                              </span>
                            ) : null}
                          </div>
                          <p style={{ color: "var(--text-secondary)", margin: "0.5rem 0 0 0", fontSize: "0.85rem" }}>
                            Decentralized Address: <span className="hash-text">{searchResult.patient.walletAddress}</span>
                          </p>
                        </div>

                        <div>
                          {!searchResult.patient.patientId && !searchResult.patient.rfidUid ? (
                            <button 
                              className="btn btn-primary" 
                              style={{ padding: "0.5rem 1rem", fontSize: "0.85rem" }}
                              onClick={() => handleCreatePatientId(searchResult.patient.walletAddress)}
                            >
                              Assign Patient ID
                            </button>
                          ) : (
                            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                              <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>Write Permission:</span>
                              <span className={`badge badge-${
                                searchResult.requestStatus === "approved" ? "success" :
                                searchResult.requestStatus === "pending" ? "warning" : "danger"
                              }`} style={{ textTransform: "none", fontSize: "0.8rem", padding: "0.3rem 0.65rem" }}>
                                {searchResult.requestStatus === "approved" ? "✓ Approved (Can Add Records)" :
                                 searchResult.requestStatus === "pending" ? "⏳ Pending Acceptance" : "Not Accepted (View Only)"}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Bio Details Grid */}
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "1rem" }}>
                        <div style={{ background: "rgba(255,255,255,0.02)", padding: "0.75rem 1rem", borderRadius: "8px", border: "1px solid var(--border-glass)" }}>
                          <span style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", textTransform: "uppercase", marginBottom: "0.35rem" }}>
                            🩸 Blood Group
                          </span>
                          <span className="badge" style={{ background: "rgba(239, 68, 68, 0.15)", color: "#f87171", border: "1px solid rgba(239, 68, 68, 0.3)", fontSize: "0.95rem", fontWeight: 700, padding: "0.2rem 0.6rem" }}>
                            {searchResult.patient.bloodGroup || "Not Specified"}
                          </span>
                        </div>

                        <div style={{ background: "rgba(255,255,255,0.02)", padding: "0.75rem 1rem", borderRadius: "8px", border: "1px solid var(--border-glass)" }}>
                          <span style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", textTransform: "uppercase", marginBottom: "0.35rem" }}>
                            📅 Date of Birth
                          </span>
                          <strong style={{ fontSize: "0.95rem" }}>
                            {searchResult.patient.dob ? new Date(searchResult.patient.dob).toLocaleDateString() : "Not Recorded"}
                          </strong>
                          {searchResult.patient.dob && calculateAge(searchResult.patient.dob) !== null && (
                            <span style={{ color: "var(--text-secondary)", marginLeft: "0.4rem", fontSize: "0.85rem" }}>
                              ({calculateAge(searchResult.patient.dob)} yrs)
                            </span>
                          )}
                        </div>

                        <div style={{ background: "rgba(255,255,255,0.02)", padding: "0.75rem 1rem", borderRadius: "8px", border: "1px solid var(--border-glass)" }}>
                          <span style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", textTransform: "uppercase", marginBottom: "0.35rem" }}>
                            👤 Gender
                          </span>
                          <strong style={{ fontSize: "0.95rem" }}>
                            {searchResult.patient.gender || "Not Specified"}
                          </strong>
                        </div>

                        <div style={{ background: "rgba(255,255,255,0.02)", padding: "0.75rem 1rem", borderRadius: "8px", border: "1px solid var(--border-glass)" }}>
                          <span style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", textTransform: "uppercase", marginBottom: "0.35rem" }}>
                            💳 RFID Smart Card UID
                          </span>
                          {searchResult.patient.rfidUid ? (
                            <strong style={{ fontFamily: "monospace", color: "#38bdf8", fontSize: "0.95rem" }}>
                              🏷️ {searchResult.patient.rfidUid}
                            </strong>
                          ) : (
                            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                              <span style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>Not Registered</span>
                              {unassignedCard && (
                                <button 
                                  className="btn btn-secondary" 
                                  style={{ padding: "0.2rem 0.5rem", fontSize: "0.75rem", borderColor: "#38bdf8", color: "#38bdf8" }}
                                  disabled={assignLoading}
                                  onClick={() => handleAssignRfid(searchResult.patient.patientId || searchResult.patient.walletAddress, unassignedCard)}
                                >
                                  {assignLoading ? "Linking..." : `Link ${unassignedCard}`}
                                </button>
                              )}
                            </div>
                          )}
                        </div>

                        <div style={{ background: "rgba(255,255,255,0.02)", padding: "0.75rem 1rem", borderRadius: "8px", border: "1px solid var(--border-glass)" }}>
                          <span style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", textTransform: "uppercase", marginBottom: "0.35rem" }}>
                            📞 Contact Phone
                          </span>
                          <strong style={{ fontSize: "0.95rem" }}>
                            {searchResult.patient.phone || "Not Provided"}
                          </strong>
                        </div>

                        <div style={{ background: "rgba(255,255,255,0.02)", padding: "0.75rem 1rem", borderRadius: "8px", border: "1px solid var(--border-glass)" }}>
                          <span style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", textTransform: "uppercase", marginBottom: "0.35rem" }}>
                            🚨 Emergency Contact
                          </span>
                          <strong style={{ fontSize: "0.95rem" }}>
                            {searchResult.patient.emergencyContact || "Not Provided"}
                          </strong>
                        </div>

                        <div style={{ background: "rgba(255,255,255,0.02)", padding: "0.75rem 1rem", borderRadius: "8px", border: "1px solid var(--border-glass)" }}>
                          <span style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", textTransform: "uppercase", marginBottom: "0.35rem" }}>
                            ⚠️ Allergies
                          </span>
                          <strong style={{ fontSize: "0.95rem", color: searchResult.patient.allergies && searchResult.patient.allergies.toLowerCase() !== "none" ? "#f87171" : "var(--text-primary)" }}>
                            {searchResult.patient.allergies || "None"}
                          </strong>
                        </div>
                      </div>
                    </div>

                    {/* Operational Area: Medical History & Add Records */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2rem" }}>
                      {/* Left: Medical History (Viewable by Approved Doctor) */}
                      <div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                          <h3 style={{ margin: 0 }}>Medical History (Decentralized Ledger)</h3>
                          <button 
                            className="btn btn-secondary" 
                            style={{ padding: "0.25rem 0.65rem", fontSize: "0.75rem" }}
                            onClick={() => fetchPatientRecords(searchResult.patient.walletAddress)}
                            title="Refresh Records"
                          >
                            ↻ Refresh
                          </button>
                        </div>

                        {patientRecords.length === 0 ? (
                          <div className="glass-card" style={{ textAlign: "center", padding: "3rem 1.5rem" }}>
                            <p style={{ color: "var(--text-muted)", fontStyle: "italic", margin: 0 }}>
                              No blockchain entries recorded for this patient yet.
                            </p>
                          </div>
                        ) : (
                          <div className="block-chain-explorer" style={{ maxHeight: "550px", overflowY: "auto", paddingRight: "0.5rem" }}>
                            {patientRecords.map((rec, i) => (
                              <div key={i} className="block-card">
                                <div className="block-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                  <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                                    <span className="badge badge-success" style={{ fontSize: "0.72rem", padding: "0.2rem 0.5rem" }}>
                                      ✓ {rec.status || "Success"}
                                    </span>
                                    <span className="badge badge-primary" style={{ fontSize: "0.72rem", padding: "0.2rem 0.5rem" }}>
                                      Block #{rec.blockNumber || (i + 1)}
                                    </span>
                                  </div>
                                  <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>{rec.timestamp}</span>
                                </div>
                                <h4 style={{ margin: "0.6rem 0 0.3rem 0", color: "#60a5fa" }}>Diagnosis: {rec.diagnosis}</h4>
                                <p style={{ margin: "0.4rem 0" }}><strong>Treatment:</strong> {rec.treatment}</p>
                                {rec.notes && <p style={{ margin: "0.4rem 0", color: "var(--text-secondary)" }}><strong>Notes:</strong> {rec.notes}</p>}
                                
                                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.75rem", borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: "0.6rem", display: "flex", flexDirection: "column", gap: "5px" }}>
                                  <div>
                                    <strong>Status:</strong> <span className="badge badge-success" style={{ fontSize: "0.68rem", padding: "0.15rem 0.45rem", marginLeft: "4px" }}>Success (Mined)</span>
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
                                    <strong>To (Contract):</strong>{" "}
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
                                          📄 View Report Document ↗
                                        </a>
                                      )}
                                    </div>
                                  )}

                                  {rec.txHash && (
                                    <div style={{ marginTop: "6px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem", background: "rgba(56, 189, 248, 0.05)", padding: "0.4rem 0.6rem", borderRadius: "6px", border: "1px solid rgba(56, 189, 248, 0.2)" }}>
                                      <span>
                                        <strong>Tx Hash:</strong>{" "}
                                        <a 
                                          href={`https://sepolia.etherscan.io/tx/${rec.txHash}`} 
                                          target="_blank" 
                                          rel="noreferrer" 
                                          className="hash-text" 
                                          style={{ color: "#38bdf8", textDecoration: "underline" }}
                                        >
                                          {rec.txHash.substring(0, 14)}...{rec.txHash.substring(rec.txHash.length - 8)}
                                        </a>
                                      </span>
                                      <a 
                                        href={`https://sepolia.etherscan.io/tx/${rec.txHash}`} 
                                        target="_blank" 
                                        rel="noreferrer" 
                                        className="btn btn-secondary" 
                                        style={{ padding: "0.25rem 0.55rem", fontSize: "0.72rem", color: "#38bdf8", borderColor: "#38bdf8", whiteSpace: "nowrap" }}
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

                      {/* Right: Add Medical Reports & Record Entry */}
                      <div>
                        <h3 style={{ margin: "0 0 1rem 0" }}>Add Medical Records & Reports</h3>
                        
                        {searchResult.requestStatus === "approved" ? (
                          <div className="glass-card" style={{ background: "rgba(16, 185, 129, 0.03)", border: "1px solid rgba(16, 185, 129, 0.3)" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1.25rem", color: "#34d399", fontSize: "0.9rem", background: "rgba(16, 185, 129, 0.1)", padding: "0.6rem 0.85rem", borderRadius: "8px" }}>
                              <span style={{ fontSize: "1.1rem" }}>✓</span>
                              <span><strong>Write Permission Active:</strong> Patient has accepted your request. You can append records and medical report documents to the blockchain ledger.</span>
                            </div>
                            <form onSubmit={handleAddRecordSubmit}>
                              <div className="form-group">
                                <label>Diagnosis</label>
                                <input
                                  type="text"
                                  className="form-input"
                                  required
                                  value={newRecord.diagnosis}
                                  onChange={(e) => setNewRecord({ ...newRecord, diagnosis: e.target.value })}
                                  placeholder="e.g. Chronic Asthma"
                                  disabled={txLoading}
                                />
                              </div>
                              <div className="form-group">
                                <label>Treatment Plan</label>
                                <input
                                  type="text"
                                  className="form-input"
                                  required
                                  value={newRecord.treatment}
                                  onChange={(e) => setNewRecord({ ...newRecord, treatment: e.target.value })}
                                  placeholder="e.g. Albuterol Inhaler 2 puffs"
                                  disabled={txLoading}
                                />
                              </div>
                              <div className="form-group">
                                <label>Clinical Notes</label>
                                <textarea
                                  className="form-input"
                                  rows="3"
                                  value={newRecord.notes}
                                  onChange={(e) => setNewRecord({ ...newRecord, notes: e.target.value })}
                                  placeholder="Additional clinical observations..."
                                  disabled={txLoading}
                                ></textarea>
                              </div>
                              <div className="form-group">
                                <label>Medical Report Document (PDF, Scans, Lab Results)</label>
                                <input
                                  type="file"
                                  className="form-input"
                                  accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
                                  onChange={(e) => setReportFile(e.target.files[0])}
                                  disabled={txLoading}
                                />
                                <small style={{ color: "var(--text-muted)", fontSize: "0.75rem", display: "block", marginTop: "3px" }}>
                                  Report is cryptographically hashed with an IPFS CID and stored on the Ethereum ledger.
                                </small>
                              </div>
                              <button type="submit" className="btn btn-doctor" style={{ width: "100%" }} disabled={txLoading}>
                                {txLoading ? "Creating block..." : "Commit to Blockchain Ledger"}
                              </button>
                            </form>
                          </div>
                        ) : searchResult.requestStatus === "pending" ? (
                          <div className="glass-card" style={{ textAlign: "center", padding: "2.5rem 1.5rem", border: "1px dashed rgba(245, 158, 11, 0.4)" }}>
                            <div className="spinner" style={{ margin: "0 auto 1rem auto", width: "36px", height: "36px", borderColor: "rgba(245, 158, 11, 0.2)", borderTopColor: "#f59e0b" }}></div>
                            <h4 style={{ color: "#fbbf24", marginBottom: "0.5rem" }}>Request Pending Patient Approval</h4>
                            <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", lineHeight: 1.5, marginBottom: "1.25rem" }}>
                              You have sent a request to add medical reports for <strong>{searchResult.patient.name}</strong>. 
                              The patient must accept the request from their dashboard before you can commit records to the blockchain.
                            </p>
                            <span className="badge badge-warning" style={{ textTransform: "none", padding: "0.4rem 1rem", fontSize: "0.85rem" }}>
                              ⏳ Awaiting Patient Acceptance
                            </span>
                            <div style={{ marginTop: "1.5rem", padding: "1rem", background: "rgba(255,255,255,0.02)", borderRadius: "8px", fontSize: "0.82rem", color: "var(--text-muted)" }}>
                              🔒 The record creation form will automatically unlock once the patient approves.
                            </div>
                          </div>
                        ) : (
                          <div className="glass-card" style={{ textAlign: "center", padding: "2.5rem 1.5rem", border: "1px dashed var(--border-glass)" }}>
                            <div style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>🔒</div>
                            <h4 style={{ marginBottom: "0.5rem" }}>
                              {searchResult.requestStatus === "rejected" ? "Request Rejected by Patient" :
                               searchResult.requestStatus === "revoked" ? "Write Access Revoked" : "Permission Required to Add Reports"}
                            </h4>
                            <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", lineHeight: 1.5, marginBottom: "1.5rem" }}>
                              {searchResult.requestStatus === "rejected"
                                ? "The patient did not accept your previous request to add medical reports. You can view their existing history, or re-send a request."
                                : searchResult.requestStatus === "revoked"
                                ? "The patient revoked write consent. You can view existing history, or request permission again."
                                : "You can view existing medical history. If you want to add new medical reports, prescriptions, or diagnosis records, send an access request to the patient."}
                            </p>
                          <button 
                            className="btn btn-doctor"
                            onClick={() => handleRequestAccess(searchResult.patient)}
                            disabled={loading}
                            style={{ width: "100%", padding: "0.85rem 1.5rem" }}
                          >
                            {loading ? "Sending..." : "📩 Send Request to Add Medical Reports"}
                          </button>
                          <div style={{ marginTop: "1.25rem", fontSize: "0.8rem", color: "var(--text-muted)" }}>
                            Once the patient accepts the request, you can add medical reports and commit records on-chain.
                          </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </main>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
