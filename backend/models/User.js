const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  password: {
    type: String,
    required: true
  },
  walletAddress: {
    type: String,
    required: true,
    unique: true,
    lowercase: true
  },
  role: {
    type: String,
    enum: ["admin", "doctor", "patient"],
    required: true
  },
  name: {
    type: String,
    required: true
  },
  // Patient specific fields
  dob: {
    type: Date
  },
  bloodGroup: {
    type: String,
    enum: ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "Unknown", ""],
    default: "Unknown"
  },
  gender: {
    type: String,
    enum: ["Male", "Female", "Other", "Prefer not to say", ""],
    default: ""
  },
  phone: {
    type: String,
    default: ""
  },
  emergencyContact: {
    type: String,
    default: ""
  },
  allergies: {
    type: String,
    default: "None"
  },
  patientId: {
    type: String,
    unique: true,
    sparse: true // Allows multiple null/undefined values for non-patients
  },
  rfidUid: {
    type: String,
    unique: true,
    sparse: true, // Allows multiple null/undefined values
    trim: true,
    uppercase: true
  },
  // Doctor specific fields
  doctorRegistrationId: {
    type: String,
    trim: true
  },
  status: {
    type: String,
    enum: ["pending", "approved", "rejected"],
    default: function() {
      return this.role === "doctor" ? "pending" : "approved";
    }
  },
  certificateUrl: {
    type: String // path or base64 contents
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model("User", UserSchema);
