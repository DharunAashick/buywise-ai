import type { Request, Response } from "express";
import { config } from "../config.js";
import { userStore, type User } from "./users.js";

export const SESSION_COOKIE = "bw_session";

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

export function setCookie(res: Response, name: string, value: string, maxAgeSeconds: number) {
  const secure = config.publicUrl.startsWith("https://") ? "; Secure" : "";
  res.append("set-cookie", `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`);
}

export function clearCookie(res: Response, name: string) {
  res.append("set-cookie", `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export function currentUser(req: Request): User | undefined {
  return userStore.userForToken(readCookie(req, SESSION_COOKIE));
}
