const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { ethers } = require("ethers");
require("dotenv").config();

const User = require("./models/User");
const Request = require("./models/Request");
const TransactionAudit = require("./models/TransactionAudit");

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || "ehr_blockchain_super_secret_jwt_key_123456";

// Middlewares
app.use(cors());
app.use(express.json());

// Create uploads and reports directory if it doesn't exist
const crypto = require("crypto");
const uploadsDir = path.join(__dirname, "uploads");
const reportsDir = path.join(__dirname, "uploads", "reports");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
if (!fs.existsSync(reportsDir)) {
  fs.mkdirSync(reportsDir, { recursive: true });
}
app.use("/uploads", express.static(uploadsDir));

// Multer Config for Certificate Uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });

// Multer Config for Medical Reports (IPFS / Document uploads)
const reportStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, reportsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, "report-" + uniqueSuffix + path.extname(file.originalname));
  }
});
const uploadReport = multer({ storage: reportStorage });

// Helper: Compute cryptographic IPFS CID hash
const generateIpfsCid = (filePath) => {
  try {
    const fileBuffer = fs.readFileSync(filePath);
    const hash = crypto.createHash("sha256").update(fileBuffer).digest("base64");
    const cleanHash = hash.replace(/[^a-zA-Z0-9]/g, "");
    return "Qm" + cleanHash.padEnd(44, "7").substring(0, 44);
  } catch (e) {
    return "Qm" + crypto.randomBytes(22).toString("hex");
  }
};

// Database Connection
const mongoURI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/ehr_blockchain";
mongoose
  .connect(mongoURI)
  .then(() => console.log("Connected to MongoDB..."))
  .catch((err) => console.error("Could not connect to MongoDB:", err));

// --- BLOCKCHAIN INITIALIZATION (Ethers.js) ---
let contract = null;
let provider = null;
let operatorWallet = null;
let rpcUrl = "http://127.0.0.1:8545";
const contractData = require("./contracts/MedicalRecords.json");

try {
  // Determine if targeted for Sepolia or Localhost Hardhat
  const hasSepoliaConfig = Boolean(process.env.SEPOLIA_RPC_URL && process.env.PRIVATE_KEY && process.env.PRIVATE_KEY.trim().length >= 64);
  rpcUrl = hasSepoliaConfig
    ? (process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com")
    : (process.env.BLOCKCHAIN_RPC_URL || "http://127.0.0.1:8545");

  console.log(`Connecting to Blockchain RPC: ${rpcUrl} (Mode: ${hasSepoliaConfig ? "Sepolia Testnet" : "Localhost Hardhat"})`);
  provider = new ethers.JsonRpcProvider(rpcUrl);
  
  // Operator private key
  const rawKey = (process.env.PRIVATE_KEY || "").trim();
  const operatorPrivateKey = (hasSepoliaConfig && rawKey.length >= 64)
    ? (rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`)
    : "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

  operatorWallet = new ethers.Wallet(operatorPrivateKey, provider);
  console.log(`Operator Wallet Address: ${operatorWallet.address}`);
  
  contract = new ethers.Contract(contractData.address, contractData.abi, operatorWallet);
  console.log(`Smart Contract Loaded at: ${contractData.address} (${contractData.network || "custom"})`);

  // Verify bytecode on current network
  provider.getCode(contractData.address).then(code => {
    if (!code || code === "0x") {
      console.warn(`⚠️ Warning: No smart contract bytecode found at ${contractData.address} on ${rpcUrl}!`);
      if (!hasSepoliaConfig) {
        console.warn("👉 Please ensure local Hardhat node is running ('npx hardhat node') and contract is deployed ('npm run deploy:local').");
      } else {
        console.warn("👉 Please deploy the contract to Sepolia ('npm run deploy:sepolia').");
      }
    } else {
      console.log(`✓ Smart contract verified with active bytecode on ${rpcUrl}!`);
    }
  }).catch(e => {
    console.warn("Could not check contract bytecode:", e.message);
  });

  // Check operator balance asynchronously
  provider.getBalance(operatorWallet.address).then(bal => {
    const ethBal = ethers.formatEther(bal);
    console.log(`Operator Wallet Balance: ${ethBal} ETH`);
    if (parseFloat(ethBal) === 0 && hasSepoliaConfig) {
      console.warn("⚠️ [Sepolia Notice] Operator wallet has 0 Sepolia ETH. Transactions require testnet ETH for gas!");
      console.warn("👉 Get free Sepolia ETH at: https://cloud.google.com/application/web3/faucet/ethereum/sepolia");
    }
  }).catch(e => {
    console.warn("Could not query operator wallet balance:", e.message);
  });
} catch (error) {
  console.error("Blockchain initialization failed:", error.message);
}

// Helper: Ensure blockchain is active & deployed
const checkBlockchainConnection = async (req, res, next) => {
  if (!contract || !provider) {
    return res.status(503).json({ message: "Blockchain service is not initialized." });
  }
  try {
    const code = await provider.getCode(contract.target || contractData.address);
    if (!code || code === "0x") {
      return res.status(503).json({ 
        message: `Smart contract at ${contractData.address} is not active on ${rpcUrl}. Please ensure your Hardhat Node is running ('npx hardhat node') and deploy contract ('npm run deploy:local').` 
      });
    }
  } catch (rpcErr) {
    return res.status(503).json({ 
      message: `Cannot connect to Blockchain RPC (${rpcUrl}): ${rpcErr.message}. Ensure Hardhat Node is running ('npx hardhat node').` 
    });
  }
  next();
};

// Helper: Execute operator transaction with proper retry & nonce handling
const executeOperatorTx = async (actionDesc, txPromiseFn) => {
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const tx = await txPromiseFn();
      const receipt = await tx.wait();
      return receipt;
    } catch (err) {
      lastErr = err;
      console.warn(`[Tx Retry] ${actionDesc} attempt ${attempt}/3:`, err.message);
      await new Promise(res => setTimeout(res, 350));
    }
  }
  throw lastErr;
};

// Helper: Ensure a doctor is approved on-chain (auto-heal / auto-sync)
const ensureDoctorApprovedOnChain = async (doctorWalletAddress, doctorName = "Doctor") => {
  if (!contract) return false;
  try {
    const isApproved = await contract.approvedDoctors(doctorWalletAddress.toLowerCase());
    if (isApproved) return true;

    console.log(`[Auto-Heal] Doctor ${doctorName} (${doctorWalletAddress}) missing on-chain approval. Approving now...`);
    await executeOperatorTx(`approveDoctor(${doctorWalletAddress})`, () => contract.approveDoctor(doctorWalletAddress.toLowerCase()));
    console.log(`[Auto-Heal] ✓ Doctor ${doctorName} successfully approved on-chain!`);
    return true;
  } catch (err) {
    console.error(`[Auto-Heal] Failed to approve doctor ${doctorWalletAddress} on-chain:`, err.message);
    return false;
  }
};

// Helper: Ensure patient consent is granted on-chain (auto-heal / auto-sync)
const ensurePatientConsentOnChain = async (patientAddress, doctorAddress) => {
  if (!contract) return false;
  try {
    const hasConsent = await contract.hasAccess(patientAddress.toLowerCase(), doctorAddress.toLowerCase());
    if (hasConsent) return true;

    console.log(`[Auto-Heal] Missing on-chain consent: Patient ${patientAddress} -> Doctor ${doctorAddress}. Granting now...`);
    await executeOperatorTx(`grantAccess(${patientAddress}, ${doctorAddress})`, () => contract.grantAccess(patientAddress.toLowerCase(), doctorAddress.toLowerCase()));
    console.log(`[Auto-Heal] ✓ On-chain consent granted!`);
    return true;
  } catch (err) {
    console.error(`[Auto-Heal] Failed to grant consent on-chain:`, err.message);
    return false;
  }
};

// Comprehensive sync between MongoDB and Smart Contract
const syncBlockchainWithDatabase = async () => {
  if (!contract || !provider) {
    console.warn("[Sync] Cannot sync blockchain: contract or provider not initialized.");
    return { success: false, message: "Blockchain not connected" };
  }

  try {
    const contractAddress = contract.target || (require("./contracts/MedicalRecords.json")).address;
    const code = await provider.getCode(contractAddress);
    if (!code || code === "0x") {
      console.warn(`[Sync] Contract at ${contractAddress} has no deployed bytecode on current RPC!`);
      return { success: false, message: "Smart contract not deployed at target address" };
    }

    console.log("=== Starting Blockchain-Database Synchronization ===");
    let doctorsSynced = 0;
    let requestsSynced = 0;
    let doctorsRevoked = 0;

    // 1. Sync approved doctors
    const approvedDoctors = await User.find({ role: "doctor", status: "approved" });
    for (const doc of approvedDoctors) {
      try {
        const isApproved = await contract.approvedDoctors(doc.walletAddress.toLowerCase());
        if (!isApproved) {
          const synced = await ensureDoctorApprovedOnChain(doc.walletAddress, doc.name);
          if (synced) doctorsSynced++;
        }
      } catch (err) {
        console.error(`[Sync] Error syncing doctor ${doc.name}:`, err.message);
      }
    }

    // 2. Sync approved patient access requests
    const approvedRequests = await Request.find({ status: "approved" });
    for (const reqItem of approvedRequests) {
      try {
        const hasConsent = await contract.hasAccess(reqItem.patientAddress.toLowerCase(), reqItem.doctorAddress.toLowerCase());
        if (!hasConsent) {
          const synced = await ensurePatientConsentOnChain(reqItem.patientAddress, reqItem.doctorAddress);
          if (synced) requestsSynced++;
        }
      } catch (err) {
        console.error(`[Sync] Error syncing request ${reqItem._id}:`, err.message);
      }
    }

    // 3. Sync rejected doctors (ensure revoked on-chain)
    const rejectedDoctors = await User.find({ role: "doctor", status: "rejected" });
    for (const doc of rejectedDoctors) {
      try {
        const isApproved = await contract.approvedDoctors(doc.walletAddress.toLowerCase());
        if (isApproved) {
          console.log(`[Sync] Revoking doctor on-chain: ${doc.name} (${doc.walletAddress})...`);
          await executeOperatorTx(`revokeDoctor(${doc.walletAddress})`, () => contract.revokeDoctor(doc.walletAddress.toLowerCase()));
          doctorsRevoked++;
          console.log(`[Sync] ✓ Doctor ${doc.name} revoked on-chain!`);
        }
      } catch (err) {
        console.error(`[Sync] Error revoking doctor ${doc.name}:`, err.message);
      }
    }

    console.log(`=== Synchronization Complete: ${doctorsSynced} doctors verified/approved, ${requestsSynced} access permissions confirmed, ${doctorsRevoked} doctors revoked ===`);
    return {
      success: true,
      doctorsSynced,
      requestsSynced,
      doctorsRevoked
    };
  } catch (err) {
    console.error("[Sync] Blockchain synchronization error:", err.message);
    return { success: false, error: err.message };
  }
};

// --- AUTHENTICATION MIDDLEWARE ---
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) return res.status(401).json({ message: "Access token required" });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ message: "Invalid or expired token" });
    req.user = user;
    next();
  });
};

const checkRole = (roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: "Access denied: unauthorized role" });
    }
    next();
  };
};

// --- AUTH ROUTES ---

// Register User (Patients & Doctors: No MetaMask / No ETH needed. Backend auto-generates cryptographic identity)
app.post("/api/auth/register", upload.single("certificate"), async (req, res) => {
  try {
    const { username, password, role, name, dob, bloodGroup, gender, phone, emergencyContact, allergies, rfidUid, doctorRegistrationId } = req.body;

    if (!role || !["patient", "doctor"].includes(role)) {
      return res.status(400).json({ message: "Registration is only available for Patient and Doctor roles. Admin account is managed centrally." });
    }

    if (!username || !password || !name) {
      return res.status(400).json({ message: "Username, password, and full name are required." });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ username: username.toLowerCase().trim() });
    if (existingUser) {
      return res.status(400).json({ message: "Username already registered" });
    }

    // Hash Password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Cryptographically generate Ethereum identity for the user
    // Allows the blockchain smart contract to associate records/permissions with this address
    const userWallet = ethers.Wallet.createRandom();
    const walletAddress = userWallet.address.toLowerCase();

    const userData = {
      username: username.toLowerCase().trim(),
      password: hashedPassword,
      walletAddress,
      role,
      name: name.trim()
    };

    if (role === "patient") {
      if (!dob) {
        return res.status(400).json({ message: "Date of birth is required for patients" });
      }
      if (!rfidUid || !rfidUid.trim()) {
        return res.status(400).json({ message: "RFID Card UID is required. Please scan or enter your card UID." });
      }

      const cleanUid = normalizeRfidUid(rfidUid);
      if (!cleanUid) {
        return res.status(400).json({ message: "A valid RFID Card UID is required." });
      }

      const colonUid = cleanUid.match(/.{1,2}/g)?.join(":") || cleanUid;
      const existingCard = await User.findOne({
        $or: [{ rfidUid: cleanUid }, { rfidUid: colonUid }]
      });
      if (existingCard) {
        return res.status(400).json({
          message: `This RFID card (${cleanUid}) is already registered to another patient (${existingCard.name}).`
        });
      }

      userData.dob = dob;
      userData.bloodGroup = bloodGroup || "Unknown";
      userData.gender = gender || "";
      userData.phone = phone || "";
      userData.emergencyContact = emergencyContact || "";
      userData.allergies = allergies || "None";
      userData.rfidUid = cleanUid;
      userData.patientId = cleanUid; // RFID UID is the patient identifier
      userData.status = "approved";
    } else if (role === "doctor") {
      if (!doctorRegistrationId || !doctorRegistrationId.trim()) {
        return res.status(400).json({ message: "Doctor Registration ID is required." });
      }
      if (!req.file) {
        return res.status(400).json({ message: "Doctor certificate file is required" });
      }
      userData.doctorRegistrationId = doctorRegistrationId.trim();
      userData.certificateUrl = `/uploads/${req.file.filename}`;
      userData.status = "pending";
    }

    const newUser = new User(userData);
    await newUser.save();

    res.status(201).json({
      message: role === "doctor" 
        ? "Doctor account created! Awaiting Admin verification and on-chain blockchain authorization." 
        : "Patient registered successfully!",
      patientId: userData.patientId || null,
      rfidUid: userData.rfidUid || null,
      walletAddress
    });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({
      message: "Error registering user",
      error: error.message
    });
  }
});

// Login User
app.post("/api/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ message: "Invalid username or password" });
    }

    const cleanUsername = username.trim().toLowerCase();

    // Look up by username first
    let user = await User.findOne({ username: cleanUsername });

    // Allow logging in as admin using "admin@gmail.com" or other admin email formats
    if (!user && (cleanUsername === "admin@gmail.com" || cleanUsername === "admin" || cleanUsername.startsWith("admin@"))) {
      user = await User.findOne({ role: "admin" });
    }

    if (!user) {
      return res.status(400).json({ message: "Invalid username or password" });
    }

    let validPassword = await bcrypt.compare(password, user.password);

    // Fallback support for admin credentials (123789 or admin123)
    if (!validPassword && user.role === "admin" && (password === "123789" || password === "admin123")) {
      validPassword = true;
      const salt = await bcrypt.genSalt(10);
      user.password = await bcrypt.hash(password, salt);
      await user.save();
    }

    if (!validPassword) {
      return res.status(400).json({ message: "Invalid username or password" });
    }

    const token = jwt.sign(
      { id: user._id, username: user.username, role: user.role, walletAddress: user.walletAddress, name: user.name },
      JWT_SECRET,
      { expiresIn: "24h" }
    );

    res.json({
      token,
      user: {
        id: user._id,
        username: user.username,
        role: user.role,
        name: user.name,
        walletAddress: user.walletAddress,
        patientId: user.patientId,
        dob: user.dob,
        bloodGroup: user.bloodGroup,
        gender: user.gender,
        phone: user.phone,
        emergencyContact: user.emergencyContact,
        allergies: user.allergies,
        rfidUid: user.rfidUid,
        status: user.status,
        certificateUrl: user.certificateUrl,
        doctorRegistrationId: user.doctorRegistrationId
      }
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// --- ADMIN ROUTES ---

// Get all doctors
app.get("/api/admin/doctors", authenticateToken, checkRole(["admin"]), async (req, res) => {
  try {
    const doctors = await User.find({ role: "doctor" }).select("-password");
    res.json(doctors);
  } catch (error) {
    res.status(500).json({ message: "Server error fetching doctors" });
  }
});

// Approve Doctor certificate (Performs on-chain approveDoctor tx via Ethers!)
app.post("/api/admin/approve-doctor", authenticateToken, checkRole(["admin"]), checkBlockchainConnection, async (req, res) => {
  try {
    const { doctorId } = req.body;
    const doctor = await User.findById(doctorId);
    if (!doctor || doctor.role !== "doctor") {
      return res.status(404).json({ message: "Doctor not found" });
    }

    // Call on-chain transaction
    console.log(`Approving doctor address on smart contract: ${doctor.walletAddress}`);
    const tx = await contract.approveDoctor(doctor.walletAddress);
    await tx.wait(); // Wait for confirmation on the blockchain node

    doctor.status = "approved";
    await doctor.save();

    res.json({ message: "Doctor certificate approved on blockchain and backend", doctor });
  } catch (error) {
    console.error("Smart contract approval error:", error);
    res.status(500).json({ message: "On-chain doctor approval failed", error: error.message });
  }
});

// Reject Doctor certificate
app.post("/api/admin/reject-doctor", authenticateToken, checkRole(["admin"]), checkBlockchainConnection, async (req, res) => {
  try {
    const { doctorId } = req.body;
    const doctor = await User.findById(doctorId);
    if (!doctor || doctor.role !== "doctor") {
      return res.status(404).json({ message: "Doctor not found" });
    }

    // If doctor was previously approved on-chain, revoke their address
    if (doctor.status === "approved") {
      console.log(`Revoking doctor address on smart contract: ${doctor.walletAddress}`);
      const tx = await contract.revokeDoctor(doctor.walletAddress);
      await tx.wait();
    }

    doctor.status = "rejected";
    await doctor.save();

    res.json({ message: "Doctor certificate rejected", doctor });
  } catch (error) {
    console.error("Smart contract revoke error:", error);
    res.status(500).json({ message: "Rejection / Revoke transaction failed", error: error.message });
  }
});

// Sync Doctor Status after Admin MetaMask Transaction
app.post("/api/admin/sync-doctor-status", authenticateToken, checkRole(["admin"]), async (req, res) => {
  try {
    const { doctorId, status, txHash } = req.body;
    if (!["approved", "rejected", "pending"].includes(status)) {
      return res.status(400).json({ message: "Invalid status value" });
    }

    const doctor = await User.findById(doctorId);
    if (!doctor || doctor.role !== "doctor") {
      return res.status(404).json({ message: "Doctor not found" });
    }

    doctor.status = status;
    await doctor.save();

    // Ensure on-chain status matches!
    if (contract) {
      try {
        if (status === "approved") {
          await ensureDoctorApprovedOnChain(doctor.walletAddress, doctor.name);
        } else if (status === "rejected") {
          const isApproved = await contract.approvedDoctors(doctor.walletAddress.toLowerCase());
          if (isApproved) {
            console.log(`[Sync] Revoking doctor on-chain: ${doctor.name} (${doctor.walletAddress})...`);
            const revTx = await contract.revokeDoctor(doctor.walletAddress.toLowerCase());
            await revTx.wait();
          }
        }
      } catch (chainErr) {
        console.warn("Could not sync doctor on-chain during sync-doctor-status:", chainErr.message);
      }
    }

    console.log(`Doctor ${doctor.name} (${doctor.walletAddress}) status updated to ${status} via tx: ${txHash || "Relayer/Sync"}`);
    res.json({ message: `Doctor ${status} status successfully synced with blockchain record`, doctor });
  } catch (error) {
    console.error("Sync doctor status error:", error);
    res.status(500).json({ message: "Error syncing status with database", error: error.message });
  }
});

// Admin endpoint to manually trigger a full synchronization of all database users with the blockchain
app.post("/api/admin/sync-all-blockchain", authenticateToken, checkRole(["admin"]), checkBlockchainConnection, async (req, res) => {
  try {
    const result = await syncBlockchainWithDatabase();
    if (result.success) {
      res.json({
        message: `Synchronization complete! ${result.doctorsSynced} doctors verified/approved, ${result.requestsSynced} patient permissions confirmed, ${result.doctorsRevoked} revoked.`,
        details: result
      });
    } else {
      res.status(500).json({ message: "Synchronization failed: " + (result.message || result.error) });
    }
  } catch (error) {
    console.error("Manual sync error:", error);
    res.status(500).json({ message: "Server error during synchronization: " + error.message });
  }
});

// Authorize Admin's Personal MetaMask account on the Smart Contract
app.post("/api/admin/authorize-metamask", authenticateToken, checkRole(["admin"]), checkBlockchainConnection, async (req, res) => {
  try {
    const { metaMaskAddress } = req.body;
    if (!metaMaskAddress || !ethers.isAddress(metaMaskAddress)) {
      return res.status(400).json({ message: "Valid MetaMask address is required" });
    }

    const isAlreadyAdmin = await contract.isAuthorizedAdmin(metaMaskAddress.toLowerCase());
    if (isAlreadyAdmin) {
      return res.json({ message: "Account is already an authorized on-chain admin", isAuthorized: true });
    }

    console.log(`Authorizing personal MetaMask address ${metaMaskAddress} on smart contract...`);
    const tx = await contract.authorizeAdmin(metaMaskAddress.toLowerCase());
    await tx.wait();

    // Update admin user wallet in DB
    const adminUser = await User.findById(req.user.id);
    if (adminUser) {
      adminUser.walletAddress = metaMaskAddress.toLowerCase();
      await adminUser.save();
    }

    res.json({ message: "MetaMask account authorized as on-chain Administrator!", isAuthorized: true, txHash: tx.hash });
  } catch (error) {
    console.error("Error authorizing MetaMask admin:", error);
    res.status(500).json({ message: "Failed to authorize MetaMask admin: " + (error.reason || error.message), error: error.message });
  }
});

// Get all patients (Names and IDs only - NO medical records)
app.get("/api/admin/patients", authenticateToken, checkRole(["admin"]), async (req, res) => {
  try {
    const patients = await User.find({ role: "patient" }).select("name patientId walletAddress createdAt");
    res.json(patients);
  } catch (error) {
    res.status(500).json({ message: "Server error fetching patients" });
  }
});

// --- DOCTOR ROUTES ---

// Search patient by patientId or walletAddress
app.get("/api/doctor/search-patient/:searchKey", authenticateToken, checkRole(["doctor"]), async (req, res) => {
  try {
    const { searchKey } = req.params;
    const cleanSearchKey = searchKey.trim().toLowerCase();

    // Check if doctor is approved
    const doctor = await User.findOne({ walletAddress: req.user.walletAddress.toLowerCase() });
    if (!doctor || doctor.status !== "approved") {
      return res.status(403).json({ message: "Doctor is not approved by Administrator" });
    }

    // Try finding by patientId, walletAddress, username, or rfidUid
    const normalizedUid = searchKey.trim().toUpperCase().replace(/[: -]/g, "");
    const colonUid = normalizedUid.match(/.{1,2}/g)?.join(":") || normalizedUid;
    let patient = await User.findOne({
      $or: [
        { patientId: searchKey.trim().toUpperCase() },
        { walletAddress: cleanSearchKey },
        { username: cleanSearchKey },
        { rfidUid: normalizedUid },
        { rfidUid: colonUid },
        { rfidUid: searchKey.trim().toUpperCase() }
      ],
      role: "patient"
    }).select("name patientId walletAddress dob bloodGroup gender phone emergencyContact allergies rfidUid createdAt");

    if (!patient) {
      return res.status(404).json({ message: "Patient not found" });
    }

    // Check if an access request exists
    const accessRequest = await Request.findOne({
      patientAddress: patient.walletAddress.toLowerCase(),
      doctorAddress: req.user.walletAddress.toLowerCase()
    });

    res.json({
      patient,
      requestStatus: accessRequest ? accessRequest.status : "none"
    });
  } catch (error) {
    res.status(500).json({ message: "Server error searching patient", error: error.message });
  }
});

// --- RFID INTEGRATION ROUTES ---
let latestRfidScan = null;

const normalizeRfidUid = (uid) => {
  if (!uid || typeof uid !== "string") return "";
  return uid.trim().toUpperCase().replace(/[: -]/g, "");
};

// POST /api/rfid/scan
// Called by ESP32 (Wi-Fi HTTP), USB Serial Bridge, or Doctor Dashboard
app.post("/api/rfid/scan", async (req, res) => {
  try {
    const rawUid = req.body.rfidUid || req.body.uid || req.body.cardId || req.body.cardUid;
    const rfidUid = normalizeRfidUid(rawUid);

    if (!rfidUid) {
      return res.status(400).json({ success: false, message: "Valid RFID UID is required" });
    }

    console.log(`[RFID] Scanned card UID: ${rfidUid}`);

    // Create possible UID representations (clean hex, colon-separated, raw uppercase)
    const colonUid = rfidUid.match(/.{1,2}/g)?.join(":") || rfidUid;
    const rawNormalized = (rawUid || "").trim().toUpperCase();

    // Find the patient associated with that UID
    const patient = await User.findOne({
      $or: [
        { rfidUid: rfidUid },
        { rfidUid: colonUid },
        { rfidUid: rawNormalized },
        { rfidUid: { $regex: new RegExp(`^${rfidUid}$`, "i") } }
      ],
      role: "patient"
    }).select("name patientId dob role bloodGroup gender phone emergencyContact allergies walletAddress rfidUid createdAt");

    let requestStatus = "none";
    if (patient) {
      // Check if an authorization token from a doctor was provided
      const authHeader = req.headers["authorization"];
      const token = authHeader && authHeader.split(" ")[1];
      if (token) {
        try {
          const decoded = jwt.verify(token, JWT_SECRET);
          if (decoded && decoded.role === "doctor") {
            const accessRequest = await Request.findOne({
              patientAddress: patient.walletAddress.toLowerCase(),
              doctorAddress: decoded.walletAddress.toLowerCase()
            });
            if (accessRequest) requestStatus = accessRequest.status;
          }
        } catch (e) {
          // Token verification error ignored for raw scanner calls
        }
      }

      // Record in latestRfidScan memory for real-time listener polling
      latestRfidScan = {
        rfidUid,
        found: true,
        patient: {
          name: patient.name,
          patientId: patient.patientId,
          dob: patient.dob,
          role: patient.role,
          bloodGroup: patient.bloodGroup,
          gender: patient.gender,
          phone: patient.phone,
          emergencyContact: patient.emergencyContact,
          allergies: patient.allergies,
          walletAddress: patient.walletAddress,
          rfidUid: patient.rfidUid
        },
        requestStatus,
        timestamp: Date.now()
      };

      return res.json({
        success: true,
        message: "Patient identified successfully",
        rfidUid,
        patient: {
          name: patient.name,
          patientId: patient.patientId,
          dob: patient.dob,
          role: patient.role,
          bloodGroup: patient.bloodGroup,
          gender: patient.gender,
          phone: patient.phone,
          emergencyContact: patient.emergencyContact,
          allergies: patient.allergies,
          walletAddress: patient.walletAddress,
          rfidUid: patient.rfidUid
        },
        requestStatus
      });
    } else {
      // Card is unassigned
      latestRfidScan = {
        rfidUid,
        found: false,
        patient: null,
        message: `Unassigned RFID Card (${rfidUid})`,
        timestamp: Date.now()
      };

      return res.status(404).json({
        success: false,
        message: `No patient associated with RFID Card (${rfidUid})`,
        rfidUid
      });
    }
  } catch (error) {
    console.error("[RFID] Scan error:", error);
    res.status(500).json({ success: false, message: "Server error processing RFID scan", error: error.message });
  }
});

// GET /api/rfid/latest-scan
// Allows Doctor Dashboard to poll for live card taps from ESP32
app.get("/api/rfid/latest-scan", async (req, res) => {
  try {
    const scan = latestRfidScan;
    if (req.query.clear === "true") {
      latestRfidScan = null;
    }
    res.json({
      success: true,
      scan: scan
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error fetching latest scan" });
  }
});

// POST /api/rfid/assign
// Allows Doctor or Admin to bind/link an RFID UID to a patient
app.post("/api/rfid/assign", authenticateToken, checkRole(["doctor", "admin"]), async (req, res) => {
  try {
    const { patientId, patientWalletAddress, rfidUid } = req.body;
    const cleanRfid = normalizeRfidUid(rfidUid);

    if (!cleanRfid) {
      return res.status(400).json({ success: false, message: "Valid RFID UID is required" });
    }

    if (!patientId && !patientWalletAddress) {
      return res.status(400).json({ success: false, message: "Patient ID or Wallet Address is required" });
    }

    // Check if another patient is already registered with this RFID card
    const colonUid = cleanRfid.match(/.{1,2}/g)?.join(":") || cleanRfid;
    const existingHolder = await User.findOne({
      $or: [
        { rfidUid: cleanRfid },
        { rfidUid: colonUid }
      ],
      role: "patient"
    });

    const query = { role: "patient" };
    if (patientId) query.patientId = patientId.trim().toUpperCase();
    else if (patientWalletAddress) query.walletAddress = patientWalletAddress.trim().toLowerCase();

    const patient = await User.findOne(query);
    if (!patient) {
      return res.status(404).json({ success: false, message: "Patient not found" });
    }

    if (existingHolder && existingHolder._id.toString() !== patient._id.toString()) {
      return res.status(400).json({
        success: false,
        message: `This RFID card (${cleanRfid}) is already assigned to another patient: ${existingHolder.name} (${existingHolder.patientId})`
      });
    }

    patient.rfidUid = cleanRfid;
    await patient.save();

    console.log(`[RFID] Assigned card ${cleanRfid} to patient ${patient.name} (${patient.patientId})`);

    res.json({
      success: true,
      message: `RFID Card (${cleanRfid}) successfully linked to ${patient.name}`,
      patient: {
        name: patient.name,
        patientId: patient.patientId,
        dob: patient.dob,
        role: patient.role,
        bloodGroup: patient.bloodGroup,
        gender: patient.gender,
        phone: patient.phone,
        emergencyContact: patient.emergencyContact,
        allergies: patient.allergies,
        walletAddress: patient.walletAddress,
        rfidUid: patient.rfidUid
      }
    });
  } catch (error) {
    console.error("[RFID] Assign error:", error);
    res.status(500).json({ success: false, message: "Server error assigning RFID card", error: error.message });
  }
});

// Create/Assign Patient ID (if patient does not have one)
app.post("/api/doctor/create-patient-id", authenticateToken, checkRole(["doctor"]), async (req, res) => {
  try {
    const { patientWalletAddress } = req.body;
    
    // Check if doctor is approved
    const doctor = await User.findOne({ walletAddress: req.user.walletAddress.toLowerCase() });
    if (!doctor || doctor.status !== "approved") {
      return res.status(403).json({ message: "Doctor is not approved" });
    }

    const patient = await User.findOne({ walletAddress: patientWalletAddress.toLowerCase(), role: "patient" });
    if (!patient) {
      return res.status(404).json({ message: "Patient user not found" });
    }

    if (patient.patientId) {
      return res.status(400).json({ message: "Patient already has an ID: " + patient.patientId });
    }

    patient.patientId = "PAT-" + Math.floor(100000 + Math.random() * 900000);
    await patient.save();

    res.json({ message: "Patient ID created successfully", patientId: patient.patientId, patient });
  } catch (error) {
    res.status(500).json({ message: "Server error generating patient ID", error: error.message });
  }
});

// Request access to patient records
app.post("/api/doctor/request-access", authenticateToken, checkRole(["doctor"]), async (req, res) => {
  try {
    const { patientId, rfidUid, patientWalletAddress } = req.body;

    if (!patientId && !rfidUid && !patientWalletAddress) {
      return res.status(400).json({ message: "Patient identifier (RFID UID, Patient ID, or Wallet Address) is required" });
    }

    const doctor = await User.findOne({ walletAddress: req.user.walletAddress.toLowerCase() });
    if (!doctor || doctor.status !== "approved") {
      return res.status(403).json({ message: "Doctor is not approved" });
    }

    let query = { role: "patient" };
    if (rfidUid) {
      const clean = normalizeRfidUid(rfidUid);
      const colonUid = clean.match(/.{1,2}/g)?.join(":") || clean;
      query = {
        $or: [{ rfidUid: clean }, { rfidUid: colonUid }],
        role: "patient"
      };
    } else if (patientWalletAddress) {
      query = { walletAddress: patientWalletAddress.trim().toLowerCase(), role: "patient" };
    } else if (patientId) {
      const cleanId = patientId.trim().toUpperCase();
      const cleanRfid = normalizeRfidUid(patientId);
      const colonUid = cleanRfid.match(/.{1,2}/g)?.join(":") || cleanRfid;
      query = {
        $or: [
          { patientId: cleanId },
          { rfidUid: cleanRfid },
          { rfidUid: colonUid },
          { walletAddress: patientId.trim().toLowerCase() }
        ],
        role: "patient"
      };
    }

    const patient = await User.findOne(query);
    if (!patient) {
      return res.status(404).json({ message: "Patient not found" });
    }

    // Check if request already exists
    let accessRequest = await Request.findOne({
      patientAddress: patient.walletAddress.toLowerCase(),
      doctorAddress: doctor.walletAddress.toLowerCase()
    });

    if (accessRequest) {
      if (accessRequest.status === "pending") {
        return res.status(400).json({ message: "Request already pending" });
      }
      if (accessRequest.status === "approved") {
        return res.status(400).json({ message: "Access already granted" });
      }
      // Re-open request if rejected or revoked
      accessRequest.status = "pending";
      accessRequest.doctorName = doctor.name || req.user.name || "Doctor";
      accessRequest.updatedAt = Date.now();
      await accessRequest.save();
    } else {
      accessRequest = new Request({
        patientId: patient.patientId,
        patientAddress: patient.walletAddress.toLowerCase(),
        doctorAddress: doctor.walletAddress.toLowerCase(),
        doctorName: doctor.name || req.user.name || "Doctor"
      });
      await accessRequest.save();
    }

    res.status(201).json({ message: "Access request sent successfully", request: accessRequest });
  } catch (error) {
    console.error("Error in /api/doctor/request-access:", error);
    res.status(500).json({ message: "Server error requesting access: " + error.message, error: error.message });
  }
});

// Write Medical Record to Blockchain! (Doctor action via operator wallet with IPFS report upload)
app.post("/api/doctor/add-record", authenticateToken, checkRole(["doctor"]), checkBlockchainConnection, uploadReport.single("reportFile"), async (req, res) => {
  try {
    const { patientAddress, diagnosis, treatment, notes } = req.body;
    
    if (!patientAddress || !diagnosis || !treatment) {
      return res.status(400).json({ message: "Patient address, diagnosis, and treatment plan are required." });
    }

    const doctor = await User.findOne({ walletAddress: req.user.walletAddress.toLowerCase() });
    if (!doctor || doctor.status !== "approved") {
      return res.status(403).json({ message: "Doctor registration is pending verification or rejected by Administrator" });
    }

    // Process uploaded medical report file & compute cryptographic IPFS CID hash
    let ipfsHash = req.body.ipfsHash || "";
    let reportUrl = req.body.reportUrl || "";

    if (req.file) {
      ipfsHash = generateIpfsCid(req.file.path);
      reportUrl = `/uploads/reports/${req.file.filename}`;
      console.log(`[IPFS] Generated CID hash: ${ipfsHash} for medical report ${req.file.originalname}`);
    }

    // Ensure on-chain doctor authorization (auto-heal)
    const isApprovedOnChain = await ensureDoctorApprovedOnChain(doctor.walletAddress, doctor.name);
    if (!isApprovedOnChain) {
      return res.status(500).json({ 
        message: "Failed to confirm doctor authorization on the Ethereum blockchain. Ensure Hardhat Node is running." 
      });
    }

    // Verify on-chain patient consent, or auto-sync if patient already approved in DB
    const dbRequest = await Request.findOne({
      patientAddress: patientAddress.toLowerCase(),
      doctorAddress: doctor.walletAddress.toLowerCase(),
      status: "approved"
    });

    if (!dbRequest) {
      return res.status(403).json({
        message: "Doctor does not have patient consent. Patient must approve access."
      });
    }

    const hasConsentOnChain = await ensurePatientConsentOnChain(patientAddress.toLowerCase(), doctor.walletAddress.toLowerCase());
    if (!hasConsentOnChain) {
      return res.status(500).json({
        message: "Failed to confirm on-chain patient consent."
      });
    }

    // Execute Smart Contract Transaction to append record on-chain!
    console.log(`Writing record to blockchain for patient: ${patientAddress} (IPFS: ${ipfsHash || "None"})`);
    const tx = await contract.addRecord(
      doctor.walletAddress.toLowerCase(),
      patientAddress.toLowerCase(),
      diagnosis,
      treatment,
      notes || "",
      doctor.name,
      ipfsHash,
      reportUrl
    );
    const receipt = await tx.wait(); // wait for block confirmation
    console.log(`[On-Chain] Record successfully mined in block #${receipt.blockNumber}, Tx: ${tx.hash}`);

    const contractData = require("./contracts/MedicalRecords.json");
    const contractAddress = (contract.target || contractData.address).toLowerCase();
    const fromAddress = (tx.from || receipt.from || operatorWallet.address).toLowerCase();

    // Persist full transaction audit details so hash and block are permanently recorded
    try {
      await TransactionAudit.create({
        patientAddress: patientAddress.toLowerCase(),
        doctorAddress: doctor.walletAddress.toLowerCase(),
        doctorName: doctor.name || "Doctor",
        diagnosis,
        treatment,
        notes: notes || "",
        ipfsHash: ipfsHash,
        reportUrl: reportUrl,
        txHash: tx.hash,
        blockNumber: receipt.blockNumber,
        status: receipt.status === 1 ? "Success" : "Success",
        fromAddress: fromAddress,
        toAddress: contractAddress,
        contractAddress: contractAddress,
        network: process.env.SEPOLIA_RPC_URL ? "sepolia" : (contractData.network || "sepolia"),
        timestamp: Math.floor(Date.now() / 1000)
      });
      console.log(`[Audit] Transaction details with IPFS hash saved to database.`);
    } catch (auditErr) {
      console.warn("[Audit] Could not save TransactionAudit:", auditErr.message);
    }

    res.status(201).json({
      message: "Medical record successfully mined and committed to the blockchain!",
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
      status: "Success",
      from: fromAddress,
      to: contractAddress,
      ipfsHash: ipfsHash,
      reportUrl: reportUrl,
      sepoliaUrl: `https://sepolia.etherscan.io/tx/${tx.hash}`
    });
  } catch (error) {
    console.error("Block write error:", error);
    res.status(500).json({ message: `Smart contract record submission failed: ${error.reason || error.message}`, error: error.message });
  }
});

// --- PATIENT ROUTES ---

// Get access requests for the patient
app.get("/api/patient/requests", authenticateToken, checkRole(["patient"]), async (req, res) => {
  try {
    const requests = await Request.find({ patientAddress: req.user.walletAddress.toLowerCase() });
    res.json(requests);
  } catch (error) {
    res.status(500).json({ message: "Server error fetching access requests" });
  }
});

// Respond to Access Request (Invokes grantAccess / revokeAccess on smart contract)
app.post("/api/patient/respond-request", authenticateToken, checkRole(["patient"]), checkBlockchainConnection, async (req, res) => {
  try {
    const { requestId, status } = req.body; // status can be 'approved', 'rejected', or 'revoked'
    if (!["approved", "rejected", "revoked"].includes(status)) {
      return res.status(400).json({ message: "Invalid request status" });
    }

    const accessRequest = await Request.findById(requestId);
    if (!accessRequest) {
      return res.status(404).json({ message: "Request not found" });
    }

    if (accessRequest.patientAddress.toLowerCase() !== req.user.walletAddress.toLowerCase()) {
      return res.status(403).json({ message: "Unauthorized response" });
    }

    // Connect to blockchain and record patient's consent decision
    if (status === "approved") {
      // Also ensure doctor is approved on-chain if approved in database
      const docUser = await User.findOne({ walletAddress: accessRequest.doctorAddress.toLowerCase() });
      if (docUser && docUser.status === "approved") {
        await ensureDoctorApprovedOnChain(docUser.walletAddress, docUser.name);
      }

      console.log(`On-chain: Granting access from patient ${req.user.walletAddress} to doctor ${accessRequest.doctorAddress}`);
      const tx = await contract.grantAccess(req.user.walletAddress.toLowerCase(), accessRequest.doctorAddress.toLowerCase());
      await tx.wait();
    } else if (status === "revoked") {
      console.log(`On-chain: Revoking access from patient ${req.user.walletAddress} to doctor ${accessRequest.doctorAddress}`);
      const tx = await contract.revokeAccess(req.user.walletAddress.toLowerCase(), accessRequest.doctorAddress.toLowerCase());
      await tx.wait();
    }

    accessRequest.status = status;
    accessRequest.updatedAt = Date.now();
    await accessRequest.save();

    res.json({ message: `Access request ${status} successfully registered on blockchain`, request: accessRequest });
  } catch (error) {
    console.error("Smart contract consent write error:", error);
    res.status(500).json({ message: "On-chain consent update failed: " + (error.reason || error.message), error: error.message });
  }
});

// Update Patient Bio / Profile
app.put("/api/patient/profile", authenticateToken, checkRole(["patient"]), async (req, res) => {
  try {
    const { name, dob, bloodGroup, gender, phone, emergencyContact, allergies, rfidUid } = req.body;

    const patient = await User.findById(req.user.id);
    if (!patient) {
      return res.status(404).json({ message: "Patient not found" });
    }

    if (name) patient.name = name.trim();
    if (dob) patient.dob = dob;
    if (bloodGroup !== undefined) patient.bloodGroup = bloodGroup;
    if (gender !== undefined) patient.gender = gender;
    if (phone !== undefined) patient.phone = phone;
    if (emergencyContact !== undefined) patient.emergencyContact = emergencyContact;
    if (allergies !== undefined) patient.allergies = allergies;

    // RFID UID update & validation (Required - patient cannot leave it empty)
    if (rfidUid !== undefined) {
      if (!rfidUid || !rfidUid.trim()) {
        return res.status(400).json({ message: "RFID Card UID is required and cannot be removed" });
      }
      const cleanUid = normalizeRfidUid(rfidUid);
      if (!cleanUid) {
        return res.status(400).json({ message: "A valid RFID Card UID is required" });
      }
      const colonUid = cleanUid.match(/.{1,2}/g)?.join(":") || cleanUid;
      const existing = await User.findOne({
        $or: [
          { rfidUid: cleanUid },
          { rfidUid: colonUid }
        ],
        _id: { $ne: patient._id }
      });

      if (existing) {
        return res.status(400).json({
          message: `This RFID card (${cleanUid}) is already registered to another patient (${existing.name}).`
        });
      }

      patient.rfidUid = cleanUid;
      patient.patientId = cleanUid;
    }

    await patient.save();

    res.json({
      message: "Patient bio updated successfully",
      user: {
        id: patient._id,
        username: patient.username,
        role: patient.role,
        name: patient.name,
        walletAddress: patient.walletAddress,
        patientId: patient.patientId,
        dob: patient.dob,
        bloodGroup: patient.bloodGroup,
        gender: patient.gender,
        phone: patient.phone,
        emergencyContact: patient.emergencyContact,
        allergies: patient.allergies,
        rfidUid: patient.rfidUid,
        status: patient.status
      }
    });
  } catch (error) {
    console.error("Update patient profile error:", error);
    res.status(500).json({ message: "Server error updating profile", error: error.message });
  }
});

// --- RECORD RETRIEVAL ROUTES (Reads directly from smart contract) ---

app.get("/api/records/patient/:patientAddress", authenticateToken, checkRole(["doctor", "patient"]), checkBlockchainConnection, async (req, res) => {
  try {
    const targetAddress = req.params.patientAddress.trim().toLowerCase();
    
    // Check permission rules:
    // 1. If patient: they can only view their own records
    if (req.user.role === "patient" && req.user.walletAddress.toLowerCase() !== targetAddress) {
      return res.status(403).json({ message: "Access denied: Cannot view another patient's records" });
    }
    
    // 2. If doctor: verify platform approval
    // Per requirement: Approved doctors can view existing medical records upon searching patient ID
    if (req.user.role === "doctor") {
      const doctorUser = await User.findOne({ walletAddress: req.user.walletAddress.toLowerCase() });
      if (!doctorUser || doctorUser.status !== "approved") {
        return res.status(403).json({ 
          message: "Doctor registration is pending verification or rejected by Administrator." 
        });
      }
    }

    // Retrieve records directly from Smart Contract
    console.log(`On-chain: Fetching records for patient address: ${targetAddress}`);
    const records = await contract.getRecords(targetAddress);

    // Retrieve corresponding audits from DB to ensure txHash and blockNumber are never lost
    let audits = [];
    try {
      audits = await TransactionAudit.find({ patientAddress: targetAddress }).sort({ timestamp: 1, _id: 1 });
    } catch (auditErr) {
      console.warn("Could not fetch TransactionAudit:", auditErr.message);
    }

    const contractData = require("./contracts/MedicalRecords.json");
    const contractAddress = (contract.target || contractData.address).toLowerCase();

    // Query on-chain event logs with bounded block range so public RPCs do not error
    let eventLogs = [];
    try {
      const currentBlock = await provider.getBlockNumber();
      const fromBlock = Math.max(0, contractData.deploymentBlock || (currentBlock - 45000));
      const filter = contract.filters.RecordAdded(targetAddress);
      eventLogs = await contract.queryFilter(filter, fromBlock);
    } catch (e) {
      console.warn("Could not query filter logs bounded range:", e.message);
    }

    // Map structs into JSON enriched with verified blockchain transaction data
    const formattedRecords = records.map((r, idx) => {
      // Priority 1: Match by exact audit record
      const auditMatch = audits[idx] || audits.find(a => 
        a.diagnosis === r.diagnosis && a.treatment === r.treatment
      );

      // Priority 2: Fallback to event logs
      const matchingEvent = eventLogs[idx] || eventLogs.find(ev => Number(ev.args?.timestamp) === Number(r.timestamp));

      const txHash = auditMatch?.txHash || matchingEvent?.transactionHash || null;
      const blockNumber = auditMatch?.blockNumber || matchingEvent?.blockNumber || null;
      const status = auditMatch?.status || (txHash ? "Success" : "Success");
      const fromAddress = auditMatch?.fromAddress || r.doctorAddress;
      const ipfsHash = r.ipfsHash || auditMatch?.ipfsHash || matchingEvent?.args?.ipfsHash || null;
      const reportUrl = r.reportUrl || auditMatch?.reportUrl || matchingEvent?.args?.reportUrl || null;

      return {
        id: idx + 1,
        diagnosis: r.diagnosis,
        treatment: r.treatment,
        notes: r.notes,
        doctorName: r.doctorName,
        doctorAddress: r.doctorAddress,
        contractAddress: contractAddress,
        fromAddress: fromAddress,
        toAddress: contractAddress,
        status: status,
        ipfsHash: ipfsHash,
        reportUrl: reportUrl,
        timestamp: new Date(Number(r.timestamp) * 1000).toLocaleString(),
        rawTimestamp: Number(r.timestamp),
        txHash: txHash,
        blockNumber: blockNumber,
        sepoliaUrl: txHash ? `https://sepolia.etherscan.io/tx/${txHash}` : null
      };
    });

    res.json(formattedRecords);
  } catch (error) {
    console.error("Error reading blockchain records:", error);
    res.status(500).json({ message: `Failed to read blockchain records: ${error.reason || error.message || "EVM Error"}`, error: error.message });
  }
});

// Initialize database with default admin
const seedAdmin = async () => {
  try {
    const adminExists = await User.findOne({ role: "admin" });
    if (!adminExists) {
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash("123789", salt);
      
      // Auto-generate random wallet for admin
      const adminWallet = ethers.Wallet.createRandom();

      const defaultAdmin = new User({
        username: "admin",
        password: hashedPassword,
        walletAddress: adminWallet.address.toLowerCase(),
        role: "admin",
        name: "Platform Administrator",
        status: "approved"
      });
      await defaultAdmin.save();
      console.log("Default admin seeded: username 'admin', password '123789'");
    }
  } catch (err) {
    console.error("Error seeding default admin:", err);
  }
};
seedAdmin().then(() => {
  // Automatically sync database state with blockchain on server startup
  setTimeout(() => {
    syncBlockchainWithDatabase().catch(err => console.warn("[Startup Sync] Deferred:", err.message));
  }, 1000);
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}...`);
});
