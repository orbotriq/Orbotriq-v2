"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";

export function LogoutButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleLogout() {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
      });

      if (!response.ok) {
        throw new Error("Logout failed");
      }

      window.location.replace("/login");
    } catch {
      setError("Logout failed. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        className="logout-button"
        onClick={handleLogout}
        disabled={loading}
      >
        <LogOut size={16} />
        {loading ? "Signing out..." : "Sign out"}
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
