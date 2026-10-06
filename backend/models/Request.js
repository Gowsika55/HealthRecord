const mongoose = require("mongoose");

const RequestSchema = new mongoose.Schema({
  patientId: {
    type: String,
    required: true
  },
  patientAddress: {
    type: String,
    required: true,
    lowercase: true
  },
  doctorAddress: {
    type: String,
    required: true,
    lowercase: true
  },
  doctorName: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ["pending", "approved", "rejected", "revoked"],
    default: "pending"
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model("Request", RequestSchema);
