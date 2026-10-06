import React, { useState } from "react";
import Login from "./components/Login";
import AdminDashboard from "./components/AdminDashboard";
import DoctorDashboard from "./components/DoctorDashboard";
import PatientDashboard from "./components/PatientDashboard";

function MainAppContent() {
  const [token, setToken] = useState(localStorage.getItem("token"));
  const [user, setUser] = useState(JSON.parse(localStorage.getItem("user")));

  const handleLoginSuccess = (userToken, userData) => {
    localStorage.setItem("token", userToken);
    localStorage.setItem("user", JSON.stringify(userData));
    setToken(userToken);
    setUser(userData);
  };

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setToken(null);
    setUser(null);
    window.location.reload();
  };

  if (!token || !user) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  switch (user.role) {
    case "admin":
      return <AdminDashboard token={token} user={user} onLogout={handleLogout} />;
    case "doctor":
      return <DoctorDashboard token={token} user={user} onLogout={handleLogout} />;
    case "patient":
      return <PatientDashboard token={token} user={user} onLogout={handleLogout} />;
    default:
      return <Login onLoginSuccess={handleLoginSuccess} />;
  }
}

export default function App() {
  return <MainAppContent />;
}
