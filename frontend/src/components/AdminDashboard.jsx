import React, { useState, useEffect } from "react";
import { ethers } from "ethers";
import contractData from "../contracts/MedicalRecords.json";

export default function AdminDashboard({ token, user, onLogout }) {
  const [activeTab, setActiveTab] = useState("approvals");
  const [doctors, setDoctors] = useState([]);
  const [patients, setPatients] = useState([]);
  const [txLoading, setTxLoading] = useState(false);
  const [message, setMessage] = useState({ text: "", type: "" });

  // MetaMask State
  const [metaMaskAddress, setMetaMaskAddress] = useState("");
  const [metaMaskBalance, setMetaMaskBalance] = useState("");
  const [metaMaskNetwork, setMetaMaskNetwork] = useState("");
  const [metaMaskChainId, setMetaMaskChainId] = useState(null);
  const [isMetaMaskConnecting, setIsMetaMaskConnecting] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);

  // Connect MetaMask
  const connectMetaMask = async () => {
    if (!window.ethereum) {
      setMessage({
        text: "MetaMask is not installed in your browser. Please install MetaMask to perform Admin on-chain approvals.",
        type: "danger"
      });
      return;
    }

    setIsMetaMaskConnecting(true);
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const accounts = await provider.send("eth_requestAccounts", []);
      const signer = await provider.getSigner();
      const address = await signer.getAddress();
      const balance = await provider.getBalance(address);
      const network = await provider.getNetwork();

      const chainIdNum = Number(network.chainId);
      setMetaMaskAddress(address);
      setMetaMaskBalance(ethers.formatEther(balance));
      setMetaMaskNetwork(network.name || `Chain ID ${network.chainId}`);
      setMetaMaskChainId(chainIdNum);

      // Auto-prompt to switch to Sepolia if connected to another network (e.g. Hardhat or Mainnet)
      if (chainIdNum !== 11155111) {
        try {
          await window.ethereum.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: "0xaa36a7" }]
          });
        } catch (switchErr) {
          console.warn("Could not automatically switch to Sepolia:", switchErr);
        }
      }

      // Auto-authorize Personal MetaMask account on-chain via backend service wallet
      try {
        await fetch("http://localhost:5000/api/admin/authorize-metamask", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ metaMaskAddress: address })
        });
      } catch (authErr) {
        console.warn("Could not auto-authorize admin on-chain:", authErr);
      }

      setMessage({
        text: `MetaMask connected & authorized as on-chain Administrator: ${address.substring(0, 6)}...${address.substring(38)} (${parseFloat(ethers.formatEther(balance)).toFixed(4)} ETH)`,
        type: "success"
      });
    } catch (err) {
      console.error("MetaMask connection error:", err);
      setMessage({
        text: "MetaMask connection was rejected or failed. " + (err.message || ""),
        type: "danger"
      });
    } finally {
      setIsMetaMaskConnecting(false);
    }
  };

  // Switch to Hardhat Localhost 8545
  const switchToLocalhostNetwork = async () => {
    if (!window.ethereum) return;
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x7a69" }] // 31337 in hex
      });
      setTimeout(connectMetaMask, 500);
    } catch (switchError) {
      // 4902 error code indicates that the chain has not been added to MetaMask
      if (switchError.code === 4902 || switchError.message?.includes("Unrecognized chain ID")) {
        try {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: "0x7a69",
                chainName: "Hardhat Localhost",
                rpcUrls: ["http://127.0.0.1:8545"],
                nativeCurrency: {
                  name: "Ethereum",
                  symbol: "ETH",
                  decimals: 18
                }
              }
            ]
          });
          setTimeout(connectMetaMask, 500);
        } catch (addError) {
          console.error("Failed to add Hardhat network:", addError);
          setMessage({ text: "Failed to add Hardhat Localhost network to MetaMask.", type: "danger" });
        }
      } else {
        console.error("Failed to switch network:", switchError);
        setMessage({ text: "Failed to switch network: " + switchError.message, type: "danger" });
      }
    }
  };

  // Switch to Sepolia Testnet
  const switchToSepoliaNetwork = async () => {
    if (!window.ethereum) {
      setMessage({ text: "MetaMask is not detected.", type: "danger" });
      return;
    }
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0xaa36a7" }] // 11155111 in hex
      });
      setTimeout(connectMetaMask, 500);
    } catch (switchError) {
      if (switchError.code === 4902 || switchError.message?.includes("Unrecognized chain ID") || switchError.message?.includes("wallet_addEthereumChain")) {
        try {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: "0xaa36a7",
                chainName: "Sepolia Testnet",
                rpcUrls: ["https://ethereum-sepolia-rpc.publicnode.com", "https://rpc.sepolia.org"],
                nativeCurrency: {
                  name: "Sepolia ETH",
                  symbol: "SEP",
                  decimals: 18
                },
                blockExplorerUrls: ["https://sepolia.etherscan.io"]
              }
            ]
          });
          setTimeout(connectMetaMask, 500);
        } catch (addError) {
          console.error("Failed to add Sepolia network:", addError);
          setMessage({ text: "Failed to add Sepolia network to MetaMask: " + addError.message, type: "danger" });
        }
      } else {
        console.error("Failed to switch to Sepolia:", switchError);
        setMessage({ text: "Please switch to Sepolia testnet inside MetaMask. " + (switchError.message || ""), type: "warning" });
      }
    }
  };

  // Auto-check if MetaMask is already connected & listen to events
  useEffect(() => {
    const checkMetaMask = async () => {
      if (window.ethereum) {
        try {
          const provider = new ethers.BrowserProvider(window.ethereum);
          const accounts = await provider.listAccounts();
          if (accounts.length > 0) {
            const address = accounts[0].address;
            const balance = await provider.getBalance(address);
            const network = await provider.getNetwork();
            setMetaMaskAddress(address);
            setMetaMaskBalance(ethers.formatEther(balance));
            setMetaMaskNetwork(network.name || `Chain ID ${network.chainId}`);
            setMetaMaskChainId(Number(network.chainId));
          }
        } catch (err) {
          console.error("Error checking existing MetaMask connection:", err);
        }
      }
    };
    checkMetaMask();

    if (window.ethereum) {
      window.ethereum.on?.("accountsChanged", checkMetaMask);
      window.ethereum.on?.("chainChanged", checkMetaMask);
    }

    return () => {
      if (window.ethereum) {
        window.ethereum.removeListener?.("accountsChanged", checkMetaMask);
        window.ethereum.removeListener?.("chainChanged", checkMetaMask);
      }
    };
  }, []);

  const fetchDoctors = async () => {
    try {
      const response = await fetch("http://localhost:5000/api/admin/doctors", {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json();
      if (response.ok) {
        setDoctors(data);
      }
    } catch (err) {
      console.error("Error fetching doctors:", err);
    }
  };

  const fetchPatients = async () => {
    try {
      const response = await fetch("http://localhost:5000/api/admin/patients", {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json();
      if (response.ok) {
        setPatients(data);
      }
    } catch (err) {
      console.error("Error fetching patients:", err);
    }
  };

  useEffect(() => {
    fetchDoctors();
    fetchPatients();
  }, [token]);

  // Approve Doctor directly via MetaMask (Test ETH)
  const handleApproveMetaMask = async (doctor) => {
    setMessage({ text: "", type: "" });

    if (!metaMaskAddress) {
      setMessage({
        text: "Please connect your MetaMask wallet first using the 'Connect MetaMask' button above.",
        type: "warning"
      });
      await connectMetaMask();
      return;
    }

    if (metaMaskChainId !== 11155111) {
      setMessage({
        text: "MetaMask is not on Sepolia Testnet. Please approve network switch to Sepolia.",
        type: "warning"
      });
      await switchToSepoliaNetwork();
      return;
    }

    setTxLoading(true);
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();

      // Instance of contract with Admin signer
      const contract = new ethers.Contract(contractData.address, contractData.abi, signer);

      setMessage({
        text: `Please confirm the on-chain approval transaction for Dr. ${doctor.name} in MetaMask...`,
        type: "info"
      });

      // Send on-chain transaction
      const tx = await contract.approveDoctor(doctor.walletAddress);
      
      setMessage({
        text: `Transaction submitted (${tx.hash.substring(0, 12)}...). Waiting for block confirmation on Ethereum...`,
        type: "info"
      });

      await tx.wait(); // Wait for confirmation

      // Sync status with backend
      const response = await fetch("http://localhost:5000/api/admin/sync-doctor-status", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ doctorId: doctor._id, status: "approved", txHash: tx.hash })
      });

      if (response.ok) {
        setMessage({
          text: `Dr. ${doctor.name} successfully approved on the Ethereum Blockchain! Tx: ${tx.hash}`,
          type: "success"
        });
        fetchDoctors();
      } else {
        setMessage({
          text: `On-chain tx succeeded (${tx.hash}), but backend sync reported an issue.`,
          type: "warning"
        });
      }
    } catch (error) {
      console.error("MetaMask approval error:", error);
      if (error.code === "ACTION_REJECTED" || error.message?.includes("rejected")) {
        setMessage({ text: "Transaction was rejected in MetaMask by user.", type: "danger" });
      } else {
        setMessage({ text: `Blockchain error: ${error.reason || error.message || "Approval failed"}`, type: "danger" });
      }
    } finally {
      setTxLoading(false);
    }
  };

  // Approve Doctor via Backend Service Wallet (Fallback / Relayer)
  const handleApproveRelayer = async (doctor) => {
    setMessage({ text: "", type: "" });
    setTxLoading(true);
    try {
      const response = await fetch("http://localhost:5000/api/admin/approve-doctor", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ doctorId: doctor._id })
      });

      const data = await response.json();
      if (response.ok) {
        setMessage({ text: `Dr. ${doctor.name} approved on blockchain via Backend Service Wallet!`, type: "success" });
        fetchDoctors();
      } else {
        setMessage({ text: data.message || "Failed to approve doctor", type: "danger" });
      }
    } catch (error) {
      console.error("Relayer approval error:", error);
      setMessage({ text: "Server error during on-chain approval: " + error.message, type: "danger" });
    } finally {
      setTxLoading(false);
    }
  };

  // Revoke Doctor directly via MetaMask (Test ETH)
  const handleRevokeMetaMask = async (doctor) => {
    setMessage({ text: "", type: "" });

    if (!metaMaskAddress) {
      setMessage({
        text: "Please connect your MetaMask wallet first using the 'Connect MetaMask' button.",
        type: "warning"
      });
      await connectMetaMask();
      return;
    }

    if (metaMaskChainId !== 11155111) {
      setMessage({
        text: "MetaMask is not on Sepolia Testnet. Please approve network switch to Sepolia.",
        type: "warning"
      });
      await switchToSepoliaNetwork();
      return;
    }

    setTxLoading(true);
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();

      const contract = new ethers.Contract(contractData.address, contractData.abi, signer);

      setMessage({
        text: `Please confirm the revocation transaction for Dr. ${doctor.name} in MetaMask...`,
        type: "info"
      });

      const tx = await contract.revokeDoctor(doctor.walletAddress);
      await tx.wait();

      const response = await fetch("http://localhost:5000/api/admin/sync-doctor-status", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ doctorId: doctor._id, status: "rejected", txHash: tx.hash })
      });

      if (response.ok) {
        setMessage({
          text: `Dr. ${doctor.name}'s authorization has been revoked on the blockchain ledger. Tx: ${tx.hash}`,
          type: "success"
        });
        fetchDoctors();
      }
    } catch (error) {
      console.error("MetaMask revocation error:", error);
      if (error.code === "ACTION_REJECTED" || error.message?.includes("rejected")) {
        setMessage({ text: "Transaction was rejected in MetaMask.", type: "danger" });
      } else {
        setMessage({ text: `Revocation error: ${error.reason || error.message}`, type: "danger" });
      }
    } finally {
      setTxLoading(false);
    }
  };

  // Revoke Doctor via Backend Service Wallet (Fallback / Relayer)
  const handleRevokeRelayer = async (doctor) => {
    setMessage({ text: "", type: "" });
    setTxLoading(true);
    try {
      const response = await fetch("http://localhost:5000/api/admin/reject-doctor", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ doctorId: doctor._id })
      });

      const data = await response.json();
      if (response.ok) {
        setMessage({ text: `Dr. ${doctor.name}'s on-chain authorization revoked via Backend Service Wallet!`, type: "success" });
        fetchDoctors();
      } else {
        setMessage({ text: data.message || "Failed to revoke doctor", type: "danger" });
      }
    } catch (error) {
      console.error("Relayer revoke error:", error);
      setMessage({ text: "Server error during on-chain revocation: " + error.message, type: "danger" });
    } finally {
      setTxLoading(false);
    }
  };

  // Direct Backend Operator Reject (for pending unverified certificate)
  const handleRejectOffChain = async (doctor) => {
    setMessage({ text: "", type: "" });
    try {
      const response = await fetch("http://localhost:5000/api/admin/sync-doctor-status", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ doctorId: doctor._id, status: "rejected" })
      });

      if (response.ok) {
        setMessage({ text: `Dr. ${doctor.name}'s registration has been rejected.`, type: "info" });
        fetchDoctors();
      }
    } catch (error) {
      console.error("Reject error:", error);
      setMessage({ text: "Error rejecting registration", type: "danger" });
    }
  };

  // Synchronize entire database (approved doctors and patient access) with the smart contract
  const handleSyncAllBlockchain = async () => {
    setMessage({ text: "", type: "" });
    setTxLoading(true);
    try {
      const response = await fetch("http://localhost:5000/api/admin/sync-all-blockchain", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        }
      });
      const data = await response.json();
      if (response.ok) {
        setMessage({ text: data.message || "All platform records successfully synchronized with Ethereum blockchain!", type: "success" });
        fetchDoctors();
        fetchPatients();
      } else {
        setMessage({ text: data.message || "Failed to synchronize with blockchain", type: "danger" });
      }
    } catch (error) {
      console.error("Sync all error:", error);
      setMessage({ text: "Server error during synchronization: " + error.message, type: "danger" });
    } finally {
      setTxLoading(false);
    }
  };

  // Re-sync single doctor on-chain
  const handleResyncDoctor = async (doctor) => {
    setMessage({ text: "", type: "" });
    setTxLoading(true);
    try {
      const response = await fetch("http://localhost:5000/api/admin/sync-doctor-status", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ doctorId: doctor._id, status: "approved" })
      });
      const data = await response.json();
      if (response.ok) {
        setMessage({ text: `Dr. ${doctor.name} on-chain authorization verified & confirmed!`, type: "success" });
        fetchDoctors();
      } else {
        setMessage({ text: data.message || "Failed to re-sync doctor", type: "danger" });
      }
    } catch (error) {
      setMessage({ text: "Error re-syncing doctor: " + error.message, type: "danger" });
    } finally {
      setTxLoading(false);
    }
  };

  const copyTestKey = () => {
    navigator.clipboard.writeText("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2500);
  };

  const isSepolia = metaMaskChainId === 11155111;
  const isWrongNetwork = metaMaskAddress && !isSepolia;
  const isZeroEth = metaMaskAddress && isSepolia && parseFloat(metaMaskBalance) === 0;

  const pendingDoctors = doctors.filter(doc => doc.status === "pending");
  const approvedDoctors = doctors.filter(doc => doc.status === "approved");

  return (
    <div>
      {/* Navbar */}
      <nav className="navbar">
        <a href="#" className="nav-brand">
          <span>EHR Blockchain</span> Admin Portal
        </a>
        <div className="nav-user">
          <div className="wallet-badge" style={{ borderColor: metaMaskAddress ? "var(--color-success)" : "var(--border-glass)" }}>
            <div className="wallet-dot" style={{ backgroundColor: metaMaskAddress ? "var(--color-success)" : "var(--color-warning)" }}></div>
            <span>Admin (1 only)</span>
          </div>
          <button className="btn btn-secondary" onClick={onLogout} style={{ padding: "0.5rem 1rem" }}>
            Logout
          </button>
        </div>
      </nav>

      <div className="container">
        {/* Network Mismatch Warning & Quick Switcher */}
        {isWrongNetwork && (
          <div className="badge badge-warning" style={{ width: "100%", padding: "1.25rem", marginBottom: "1.5rem", borderRadius: "10px", textTransform: "none", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
            <div>
              <strong style={{ fontSize: "1.05rem" }}>⚠️ Wrong MetaMask Network Detected: {metaMaskNetwork || "Hardhat Localhost"}</strong>
              <p style={{ margin: "0.25rem 0 0 0", fontSize: "0.85rem", opacity: 0.9 }}>
                Your MetaMask is currently on <strong>{metaMaskNetwork || "Hardhat Localhost"}</strong>. The EHR smart contract is running on the <strong>Sepolia Testnet</strong>. Please switch to Sepolia to sign transactions.
              </p>
            </div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button 
                className="btn btn-primary" 
                style={{ padding: "0.5rem 1.25rem", fontSize: "0.9rem", background: "#0ea5e9", color: "#fff", fontWeight: "bold" }}
                onClick={switchToSepoliaNetwork}
              >
                ⚡ Switch to Sepolia Testnet
              </button>
            </div>
          </div>
        )}

        {/* Zero ETH Notice on Sepolia */}
        {isZeroEth && (
          <div className="badge badge-warning" style={{ width: "100%", padding: "1rem 1.25rem", marginBottom: "1.5rem", borderRadius: "10px", textTransform: "none", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
            <div>
              <strong>💰 Need Sepolia Test ETH?</strong>
              <div style={{ fontSize: "0.85rem", marginTop: "2px" }}>
                You have 0 Sepolia ETH. You need a small amount of test ETH to pay gas fees for on-chain doctor approvals.
              </div>
            </div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <a 
                href="https://cloud.google.com/application/web3/faucet/ethereum/sepolia" 
                target="_blank" 
                rel="noreferrer"
                className="btn btn-secondary" 
                style={{ padding: "0.4rem 0.9rem", fontSize: "0.85rem", textDecoration: "none" }}
              >
                🚰 Google Sepolia Faucet
              </a>
              <a 
                href="https://sepoliafaucet.com/" 
                target="_blank" 
                rel="noreferrer"
                className="btn btn-secondary" 
                style={{ padding: "0.4rem 0.9rem", fontSize: "0.85rem", textDecoration: "none" }}
              >
                🚰 Alchemy Faucet
              </a>
            </div>
          </div>
        )}

        {/* MetaMask Admin Connection Banner */}
        <div className="glass-card" style={{ marginBottom: "1.5rem", borderLeft: "4px solid #f87171", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
          <div>
            <h4 style={{ margin: "0 0 0.25rem 0", display: "flex", alignItems: "center", gap: "0.5rem" }}>
              🦊 Administrator MetaMask Link (Sepolia Test ETH Required)
            </h4>
            <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--text-secondary)" }}>
              {metaMaskAddress ? (
                <>
                  Account: <strong className="hash-text">{metaMaskAddress}</strong> | Balance: <strong>{parseFloat(metaMaskBalance).toFixed(4)} ETH</strong> | Network: <strong>{metaMaskNetwork}</strong> | Contract: <a href={`https://sepolia.etherscan.io/address/${contractData.address}`} target="_blank" rel="noreferrer" style={{ color: "#38bdf8", textDecoration: "underline" }}>{contractData.address.substring(0, 10)}...</a>
                </>
              ) : (
                <>
                  Connect MetaMask with Sepolia Test ETH to sign on-chain doctor approvals. Contract: <a href={`https://sepolia.etherscan.io/address/${contractData.address}`} target="_blank" rel="noreferrer" style={{ color: "#38bdf8", textDecoration: "underline" }}>{contractData.address}</a> (Sepolia)
                </>
              )}
            </p>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
            <button 
              className="btn btn-primary"
              style={{ padding: "0.45rem 0.9rem", fontSize: "0.85rem", background: "#3b82f6", display: "flex", alignItems: "center", gap: "0.4rem" }}
              onClick={handleSyncAllBlockchain}
              disabled={txLoading}
              title="Synchronize all approved doctors and patient access permissions directly to the smart contract"
            >
              ⚡ Sync All to Blockchain
            </button>
            {metaMaskAddress ? (
              <>
                {!isSepolia ? (
                  <button 
                    className="btn btn-primary" 
                    style={{ padding: "0.45rem 0.95rem", fontSize: "0.85rem", background: "#0ea5e9", color: "#fff", fontWeight: "bold" }}
                    onClick={switchToSepoliaNetwork}
                  >
                    ⚡ Switch to Sepolia
                  </button>
                ) : (
                  <span className="badge badge-success" style={{ padding: "0.5rem 1rem", fontSize: "0.85rem" }}>
                    ✓ Sepolia Testnet
                  </span>
                )}
                <button 
                  className="btn btn-secondary" 
                  style={{ padding: "0.4rem 0.8rem", fontSize: "0.8rem", opacity: 0.6 }}
                  onClick={switchToLocalhostNetwork}
                  title="Switch to Hardhat Localhost (8545)"
                >
                  Localhost
                </button>
              </>
            ) : (
              <button 
                className="btn btn-admin" 
                onClick={connectMetaMask} 
                disabled={isMetaMaskConnecting}
                style={{ padding: "0.5rem 1.25rem", fontSize: "0.9rem" }}
              >
                {isMetaMaskConnecting ? "Connecting..." : "Connect MetaMask"}
              </button>
            )}
          </div>
        </div>

        {message.text && (
          <div className={`badge badge-${message.type}`} style={{ width: "100%", padding: "1rem", marginBottom: "1.5rem", borderRadius: "8px", textTransform: "none", fontSize: "0.95rem" }}>
            {message.text}
          </div>
        )}

        {txLoading && (
          <div className="badge badge-warning" style={{ width: "100%", padding: "1rem", marginBottom: "1.5rem", borderRadius: "8px", textTransform: "none", fontSize: "1rem", display: "flex", gap: "0.75rem", justifyContent: "center", alignItems: "center" }}>
            <div className="spinner"></div>
            <span>Transaction active / Mining on Ethereum blockchain... Please confirm in MetaMask if prompted.</span>
          </div>
        )}

        {/* Stats Grid */}
        <div className="stats-grid">
          <div className="stat-card">
            <span className="stat-label">Total Doctors</span>
            <span className="stat-value" style={{ color: "var(--accent-admin)" }}>{doctors.length}</span>
          </div>
          <div className="stat-card">
            <span className="stat-label">Pending Verifications</span>
            <span className="stat-value" style={{ color: "var(--color-warning)" }}>{pendingDoctors.length}</span>
          </div>
          <div className="stat-card">
            <span className="stat-label">Registered Patients</span>
            <span className="stat-value" style={{ color: "var(--accent-patient)" }}>{patients.length}</span>
          </div>
          <div className="stat-card">
            <span className="stat-label">MetaMask Test ETH</span>
            <span className="stat-value" style={{ color: metaMaskAddress && !isZeroEth ? "var(--color-success)" : isZeroEth ? "var(--color-warning)" : "var(--text-muted)", fontSize: "1.3rem" }}>
              {metaMaskAddress ? `${parseFloat(metaMaskBalance).toFixed(3)} ETH` : "DISCONNECTED"}
            </span>
          </div>
        </div>

        {/* Tab Layout */}
        <div className="dashboard-grid">
          <aside className="sidebar-nav">
            <div 
              className={`sidebar-link ${activeTab === "approvals" ? "active active-admin" : ""}`}
              onClick={() => setActiveTab("approvals")}
            >
              Pending Verification ({pendingDoctors.length})
            </div>
            <div 
              className={`sidebar-link ${activeTab === "doctors" ? "active active-admin" : ""}`}
              onClick={() => setActiveTab("doctors")}
            >
              Approved Doctors ({approvedDoctors.length})
            </div>
            <div 
              className={`sidebar-link ${activeTab === "patients" ? "active active-admin" : ""}`}
              onClick={() => setActiveTab("patients")}
            >
              Patient Directory
            </div>
          </aside>

          <main className="dashboard-content">
            {activeTab === "approvals" && (
              <div className="glass-card">
                <h3>Doctor Verification Requests</h3>
                <p style={{ color: "var(--text-secondary)", marginBottom: "1.5rem" }}>
                  Review uploaded doctor certificates. You can approve via <strong>MetaMask (with Test ETH)</strong> or via the <strong>Backend Relayer</strong>.
                </p>

                {pendingDoctors.length === 0 ? (
                  <p style={{ color: "var(--text-muted)", fontStyle: "italic" }}>No pending doctor registrations.</p>
                ) : (
                  <div className="table-container">
                    <table>
                      <thead>
                        <tr>
                          <th>Doctor Name</th>
                          <th>System Address</th>
                          <th>Certificate</th>
                          <th>Authorization Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pendingDoctors.map((doc) => (
                          <tr key={doc._id}>
                            <td><strong>{doc.name}</strong><br/><span style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>@{doc.username}</span></td>
                            <td className="hash-text">{doc.walletAddress}</td>
                            <td>
                              {doc.doctorRegistrationId ? (
                                <div style={{ marginBottom: "0.4rem" }}>
                                  <span style={{ fontSize: "0.72rem", color: "var(--text-secondary)", display: "block", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                                    Registration ID
                                  </span>
                                  <span style={{ fontFamily: "monospace", fontSize: "0.85rem", fontWeight: "bold", color: "#34d399", background: "rgba(52, 211, 153, 0.1)", padding: "0.15rem 0.45rem", borderRadius: "4px", border: "1px solid rgba(52, 211, 153, 0.25)", display: "inline-block" }}>
                                    {doc.doctorRegistrationId}
                                  </span>
                                </div>
                              ) : null}
                              <a 
                                href={`http://localhost:5000${doc.certificateUrl}`} 
                                target="_blank" 
                                rel="noreferrer"
                                className="btn btn-secondary"
                                style={{ padding: "0.3rem 0.75rem", fontSize: "0.8rem" }}
                              >
                                View Certificate
                              </a>
                            </td>
                            <td>
                              <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                                <button 
                                  className="btn btn-doctor" 
                                  style={{ padding: "0.35rem 0.75rem", fontSize: "0.8rem" }} 
                                  onClick={() => handleApproveMetaMask(doc)}
                                  disabled={txLoading}
                                  title="Approve directly using MetaMask and Test ETH"
                                >
                                  🦊 Approve (MetaMask)
                                </button>
                                <button 
                                  className="btn btn-primary" 
                                  style={{ padding: "0.35rem 0.75rem", fontSize: "0.8rem", background: "rgba(59,130,246,0.2)", border: "1px solid #3b82f6", color: "#60a5fa" }} 
                                  onClick={() => handleApproveRelayer(doc)}
                                  disabled={txLoading}
                                  title="Approve on-chain using Backend Service Wallet (no MetaMask gas needed)"
                                >
                                  ⚡ Approve (Relayer)
                                </button>
                                <button 
                                  className="btn btn-secondary" 
                                  style={{ padding: "0.35rem 0.6rem", fontSize: "0.8rem", color: "var(--color-danger)" }} 
                                  onClick={() => handleRejectOffChain(doc)}
                                  disabled={txLoading}
                                >
                                  Reject
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {activeTab === "doctors" && (
              <div className="glass-card">
                <h3>Authorized Doctors Ledger</h3>
                <p style={{ color: "var(--text-secondary)", marginBottom: "1.5rem" }}>
                  Doctors currently authorized on the Ethereum blockchain smart contract to request access and append diagnoses.
                </p>

                {approvedDoctors.length === 0 ? (
                  <p style={{ color: "var(--text-muted)", fontStyle: "italic" }}>No approved doctors on record.</p>
                ) : (
                  <div className="table-container">
                    <table>
                      <thead>
                        <tr>
                          <th>Doctor Name</th>
                          <th>System Address</th>
                          <th>Certificate</th>
                          <th>Status</th>
                          <th>Revoke Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {approvedDoctors.map((doc) => (
                          <tr key={doc._id}>
                            <td>
                              <strong>{doc.name}</strong>
                              {doc.doctorRegistrationId && (
                                <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "2px" }}>
                                  Reg ID: <span style={{ color: "#34d399", fontFamily: "monospace" }}>{doc.doctorRegistrationId}</span>
                                </div>
                              )}
                            </td>
                            <td className="hash-text">{doc.walletAddress}</td>
                            <td>
                              <a 
                                href={`http://localhost:5000${doc.certificateUrl}`} 
                                target="_blank" 
                                rel="noreferrer"
                                style={{ color: "#3b82f6", textDecoration: "underline" }}
                              >
                                View File
                              </a>
                            </td>
                            <td>
                              <span className="badge badge-success" style={{ fontSize: "0.75rem" }}>
                                ON-CHAIN APPROVED
                              </span>
                            </td>
                            <td>
                              <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                                <button 
                                  className="btn btn-primary" 
                                  style={{ padding: "0.3rem 0.6rem", fontSize: "0.8rem", background: "rgba(59,130,246,0.2)", border: "1px solid #3b82f6", color: "#60a5fa" }}
                                  onClick={() => handleResyncDoctor(doc)}
                                  disabled={txLoading}
                                  title="Force re-sync and ensure on-chain authorization for this doctor"
                                >
                                  ⚡ Re-sync
                                </button>
                                <button 
                                  className="btn btn-secondary" 
                                  style={{ padding: "0.3rem 0.6rem", fontSize: "0.8rem", color: "var(--color-danger)" }}
                                  onClick={() => handleRevokeMetaMask(doc)}
                                  disabled={txLoading}
                                  title="Revoke directly using MetaMask and Test ETH"
                                >
                                  🦊 Revoke (MetaMask)
                                </button>
                                <button 
                                  className="btn btn-secondary" 
                                  style={{ padding: "0.3rem 0.6rem", fontSize: "0.8rem", color: "var(--color-warning)" }}
                                  onClick={() => handleRevokeRelayer(doc)}
                                  disabled={txLoading}
                                  title="Revoke on-chain via Backend Service Wallet (no MetaMask gas needed)"
                                >
                                  ⚡ Revoke (Relayer)
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {activeTab === "patients" && (
              <div className="glass-card">
                <h3>Patient Directory</h3>
                <p style={{ color: "var(--text-secondary)", marginBottom: "1.5rem" }}>
                  Roster of patient profiles registered on the platform.
                </p>

                <div className="badge badge-danger" style={{ width: "100%", padding: "0.75rem", marginBottom: "1.5rem", borderRadius: "8px", textTransform: "none", fontWeight: "normal" }}>
                  <strong>Decentralized Privacy Enforced:</strong> As Administrator, you only have access to patient roster metadata (names & IDs). You cannot access patient clinical records, treatments, or diagnosis entries.
                </div>

                {patients.length === 0 ? (
                  <p style={{ color: "var(--text-muted)", fontStyle: "italic" }}>No registered patients on record.</p>
                ) : (
                  <div className="table-container">
                    <table>
                      <thead>
                        <tr>
                          <th>Patient Name</th>
                          <th>Patient ID</th>
                          <th>System Address</th>
                          <th>Joined</th>
                        </tr>
                      </thead>
                      <tbody>
                        {patients.map((pat) => (
                          <tr key={pat._id}>
                            <td><strong>{pat.name}</strong></td>
                            <td><span className="badge badge-info">{pat.patientId || "No ID Assigned"}</span></td>
                            <td className="hash-text">{pat.walletAddress}</td>
                            <td>{new Date(pat.createdAt).toLocaleDateString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
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
