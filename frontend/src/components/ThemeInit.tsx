"use client";

import { useEffect } from "react";

export default function ThemeInit() {
  useEffect(() => {
    const mode = localStorage.getItem("theme");
    if (mode === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, []);

  return null;
}
