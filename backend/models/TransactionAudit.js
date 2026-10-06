const mongoose = require("mongoose");

const TransactionAuditSchema = new mongoose.Schema({
  patientAddress: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
  },
  doctorAddress: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
  },
  doctorName: {
    type: String,
    default: "Doctor"
  },
  diagnosis: {
    type: String,
    required: true,
    trim: true
  },
  treatment: {
    type: String,
    required: true,
    trim: true
  },
  notes: {
    type: String,
    default: ""
  },
  ipfsHash: {
    type: String,
    default: ""
  },
  reportUrl: {
    type: String,
    default: ""
  },
  txHash: {
    type: String,
    required: true,
    trim: true
  },
  blockNumber: {
    type: Number,
    required: true
  },
  status: {
    type: String,
    default: "Success"
  },
  fromAddress: {
    type: String,
    lowercase: true,
    trim: true
  },
  toAddress: {
    type: String,
    lowercase: true,
    trim: true
  },
  contractAddress: {
    type: String,
    lowercase: true,
    trim: true
  },
  network: {
    type: String,
    default: "sepolia"
  },
  timestamp: {
    type: Number,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model("TransactionAudit", TransactionAuditSchema);
