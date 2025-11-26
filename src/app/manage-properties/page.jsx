"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import PropertyManager from "../components/PropertyManager";

export default function ManagePropertiesPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    checkAuth();
  }, []);

  async function checkAuth() {
    try {
      const res = await fetch("/api/auth/session");
      if (res.ok) {
        const data = await res.json();
        if (data.user && data.user.role === "Admin") {
          setIsAdmin(true);
        } else {
          router.push("/");
        }
      } else {
        router.push("/login");
      }
    } catch (err) {
      console.error("Auth check failed:", err);
      router.push("/login");
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse">Loading...</div>
      </div>
    );
  }

  if (!isAdmin) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <PropertyManager />
    </div>
  );
}
